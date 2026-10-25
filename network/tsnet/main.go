// A private userspace Tailscale node. No host daemon, TUN or Funnel is used.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"flag"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"runtime/debug"
	"strings"
	"sync"
	"syscall"
	"time"

	_ "tailscale.com/feature/useproxy" // Respect managed-system HTTP(S) proxy configuration.
	"tailscale.com/net/netns"
	"tailscale.com/tsnet"
)

type config struct {
	Target string `json:"target"`
	Token  string `json:"token"`
}
type event struct {
	State   string `json:"state"`
	AuthURL string `json:"authURL,omitempty"`
	Origin  string `json:"origin,omitempty"`
	Message string `json:"message,omitempty"`
	Ready   bool   `json:"ready"`
}

var outputMu sync.Mutex

func emit(e event) {
	outputMu.Lock()
	defer outputMu.Unlock()
	_ = json.NewEncoder(os.Stdout).Encode(e)
}

func main() {
	dir := flag.String("state-dir", "", "Private persistent tsnet state directory")
	host := flag.String("hostname", "airdrop", "Node hostname")
	version := flag.Bool("version", false, "Print embedded module build information")
	flag.Parse()
	if *version {
		info, _ := debug.ReadBuildInfo()
		modules := map[string]string{"go": info.GoVersion}
		for _, dep := range info.Deps {
			if dep.Path == "tailscale.com" {
				modules[dep.Path] = dep.Version
			}
		}
		_ = json.NewEncoder(os.Stdout).Encode(modules)
		return
	}
	if *dir == "" {
		os.Exit(2)
	}
	if err := os.MkdirAll(*dir, 0700); err != nil {
		os.Exit(2)
	}
	if err := os.Chmod(*dir, 0700); err != nil {
		os.Exit(2)
	}
	reader := bufio.NewScanner(os.Stdin)
	reader.Buffer(make([]byte, 4096), 16384)
	if !reader.Scan() {
		os.Exit(2)
	}
	var cfg config
	if json.Unmarshal(reader.Bytes(), &cfg) != nil || len(cfg.Token) < 32 {
		os.Exit(2)
	}
	target, err := url.Parse(cfg.Target)
	if err != nil || target.Scheme != "http" || target.Hostname() != "127.0.0.1" || target.Port() == "" {
		os.Exit(2)
	}
	log.SetOutput(io.Discard)
	// This process never installs host VPN routes. Use the system's normal
	// routing and configured proxies instead of privileged bypass socket marks.
	// This does not change the enclosing Flatpak/network namespace.
	netns.SetEnabled(false)
	s := &tsnet.Server{Dir: *dir, Hostname: *host, Logf: func(string, ...any) {}, UserLogf: func(string, ...any) {}}
	defer s.Close()
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer cancel()
	// Closing the parent pipe also closes the node after an Electron crash.
	go func() {
		for reader.Scan() {
		}
		cancel()
	}()
	emit(event{State: "starting", Message: "Connecting the private userspace Tailscale node…"})
	if err = s.Start(); err != nil {
		emit(event{State: "error", Message: "Unable to start Tailscale. Local sharing is still available."})
		return
	}
	lc, err := s.LocalClient()
	if err != nil {
		return
	}
	var server *http.Server
	var origin string
	loginRequested := false
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			if server != nil {
				_ = server.Close()
			}
			return
		default:
		}
		checkCtx, done := context.WithTimeout(ctx, 8*time.Second)
		st, statusErr := lc.Status(checkCtx)
		done()
		if statusErr != nil {
			emit(event{State: "connecting", Message: "Waiting for Tailscale control connectivity…"})
		} else if st.BackendState != "Running" {
			if server != nil {
				_ = server.Close()
				server = nil
				origin = ""
			}
			if st.BackendState == "NeedsLogin" && !loginRequested {
				loginCtx, end := context.WithTimeout(ctx, 8*time.Second)
				_ = lc.StartLoginInteractive(loginCtx)
				end()
				loginRequested = true
			}
			message := "Open Tailscale sign-in in your browser; devices must join the same tailnet."
			if st.AuthURL == "" {
				message = "Requesting a Tailscale sign-in link. Check internet/proxy access if this does not complete."
			}
			if st.BackendState == "NeedsMachineAuth" {
				message = "Waiting for your tailnet administrator to approve this Airdrop device."
			}
			if len(st.Health) > 0 {
				message += " Network status: " + strings.Join(st.Health, "; ")
			}
			emit(event{State: st.BackendState, AuthURL: st.AuthURL, Message: message})
		} else if len(st.CertDomains) == 0 || st.CurrentTailnet == nil || !st.CurrentTailnet.MagicDNSEnabled {
			emit(event{State: "needs-https", Message: "Enable MagicDNS and HTTPS certificates in your tailnet DNS settings. No HTTPS address is advertised yet."})
		} else {
			if server == nil {
				domain := strings.TrimSuffix(st.CertDomains[0], ".")
				if !strings.HasSuffix(domain, ".ts.net") {
					emit(event{State: "error", Message: "Unexpected tailnet certificate domain."})
					return
				}
				origin = "https://" + domain
				listener, listenErr := s.ListenTLS("tcp", ":443")
				if listenErr != nil {
					emit(event{State: "needs-https", Message: "Tailnet HTTPS is not available yet. Check your tailnet DNS/certificate settings."})
				} else {
					proxy := httputil.NewSingleHostReverseProxy(target)
					proxy.ErrorLog = log.New(io.Discard, "", 0)
					server = &http.Server{Handler: proxy, ReadHeaderTimeout: 10 * time.Second}
					go func(srv *http.Server) { _ = srv.Serve(listener) }(server)
					emit(event{State: "checking-https", Origin: origin, Message: "Verifying the HTTPS certificate and application route…"})
				}
			}
			if server != nil {
				transport := &http.Transport{DialContext: s.Dial, TLSHandshakeTimeout: 10 * time.Second}
				client := &http.Client{Transport: transport, Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
				req, _ := http.NewRequestWithContext(ctx, "GET", origin+"/push/health", nil)
				req.Header.Set("Authorization", "Bearer "+cfg.Token)
				response, probeErr := client.Do(req)
				ready := false
				if probeErr == nil {
					var health struct {
						Push  bool `json:"push"`
						Share bool `json:"share"`
					}
					decodeErr := json.NewDecoder(io.LimitReader(response.Body, 4096)).Decode(&health)
					response.Body.Close()
					ready = response.StatusCode == 200 && decodeErr == nil && health.Push && health.Share
				}
				transport.CloseIdleConnections()
				if ready {
					emit(event{State: "connected", Origin: origin, Ready: true, Message: "Tailnet HTTPS is verified. Join the same tailnet on your phone/tablet before scanning."})
				} else {
					emit(event{State: "https-unavailable", Origin: origin, Message: "HTTPS is not verified yet. Certificate provisioning or tailnet connectivity may need attention; local mode remains available."})
				}
			}
		}
		select {
		case <-ctx.Done():
			if server != nil {
				_ = server.Close()
			}
			return
		case <-ticker.C:
		}
	}
}
