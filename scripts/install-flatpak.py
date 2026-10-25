#!/usr/bin/env python3
"""Install/migrate the signed Airdrop Flatpak without replacing remote trust.

CLI trust is pinned below. No user data, permissions, existing keys or remote URLs
are rewritten. Run as the desktop user; system changes use Flatpak authorization.
"""
import argparse,base64,configparser,json,os,platform,re,subprocess,sys,tempfile
from dataclasses import dataclass
from pathlib import Path
import urllib.request
APP='io.github.fluffydisk.airdrop-linux';REF=f'app/{APP}/x86_64/stable';REMOTE='airdrop-linux'
R2='f7627ea19cc9cc901a96683a02a5efef8cf5cb3497ca423c80d76cfc6ab5fd75'
FLATHUB_KEY='6E5C05D979C76DAF93C081354184DD4D907A7CAE'
@dataclass(frozen=True)
class Trust:
 base:str='https://fluffydisk.github.io/airdrop-linux/'
 fingerprint:str='6513D70958397F60D3787A0CB93F4FC1E97CF3AE'
 minimum_revision:int=3

def command(*args,check=True):
 result=subprocess.run(list(map(str,args)),capture_output=True,text=True,env={**os.environ,'LC_ALL':'C'})
 if check and result.returncode:raise RuntimeError(result.stderr.strip() or result.stdout.strip() or 'Command failed')
 return result

def semver(value):
 if not isinstance(value,str) or not re.fullmatch(r'\d+\.\d+\.\d+',value):raise ValueError('Unsupported application version; review manually')
 return tuple(map(int,value.split('.')))

def load_key(data,path,fingerprint):
 path.write_bytes(data)
 rows=command('gpg','--no-options','--homedir',path.parent,'--batch','--with-colons','--show-keys',path).stdout.splitlines()
 fingerprints=[rows[i+1].split(':')[9] for i,row in enumerate(rows) if row.startswith('pub:')]
 if fingerprints!=[fingerprint]:raise ValueError('Repository public key does not match the pinned signing identity')

def fetch(url,path):
 with urllib.request.urlopen(url,timeout=120) as response:path.write_bytes(response.read())

def verify_channel(trust,temp):
 descriptor=temp/'airdrop-linux.flatpakrepo';fetch(trust.base+'airdrop-linux.flatpakrepo',descriptor)
 config=configparser.ConfigParser(interpolation=None);config.read(descriptor)
 section=config['Flatpak Repo']
 if section['Url']!=trust.base+'flatpak/':raise ValueError('Unexpected repository URL')
 key=temp/'key.gpg';load_key(base64.b64decode(section['GPGKey'],validate=True),key,trust.fingerprint)
 metadata=temp/'channel.json';signature=temp/'channel.json.asc'
 fetch(trust.base+'flatpak-channel.json',metadata);fetch(trust.base+'flatpak-channel.json.asc',signature)
 command('gpgv','--keyring',key,signature,metadata)
 receipt=json.loads(metadata.read_text())
 if any(receipt.get(k)!=v for k,v in {'schema':1,'app_id':APP,'arch':'x86_64','branch':'stable','fingerprint':trust.fingerprint,'repository_url':trust.base+'flatpak/'}.items()):raise ValueError('Unexpected signed channel identity')
 if type(receipt.get('revision')) is not int or receipt['revision']<trust.minimum_revision:raise ValueError('Repository predates the safe r2 migration channel')
 if semver(receipt['version'])<(1,5,0) or not re.fullmatch('[0-9a-f]{64}',receipt['commit']):raise ValueError('Invalid signed channel version/commit')
 # Verify both public summary and commit signatures before changing any install.
 repo=temp/'preflight';command('ostree',f'--repo={repo}','init','--mode=bare-user')
 command('ostree',f'--repo={repo}','remote','add',f'--gpg-import={key}','--set=gpg-verify-summary=true','channel',trust.base+'flatpak/')
 command('ostree',f'--repo={repo}','pull','--commit-metadata-only','channel',REF)
 if command('ostree',f'--repo={repo}','rev-parse','channel:'+REF).stdout.strip()!=receipt['commit']:raise ValueError('Public signed summary and channel receipt disagree; retry after publication settles')
 return descriptor,receipt

def installations():
 found=[]
 for scope in ['user','system']:
  lines=command('flatpak','list','--'+scope,'--app','--columns=application,arch,branch,origin').stdout.splitlines()
  for line in lines:
   fields=line.split('\t')
   if fields and fields[0]==APP:
    if len(fields)!=4 or fields[1:3]!=['x86_64','stable']:raise ValueError('Unexpected installed architecture/branch; no automatic migration')
    found.append((scope,fields[3]))
 # Named installations cannot be silently shadowed by a default installation.
 for config in Path('/etc/flatpak/installations.d').glob('*.conf'):
  parser=configparser.ConfigParser();parser.read(config)
  for section in parser.sections():
   match=re.fullmatch('Installation "([^"]+)"',section)
   if match and APP in command('flatpak','list','--installation='+match[1],'--app','--columns=application').stdout.splitlines():
    raise ValueError('Application exists in a named system installation; migrate that installation explicitly')
 if len(found)>1:raise ValueError('Application exists in user and system installations; resolve this ambiguity without deleting data before migration')
 return found

def repo_path(scope):
 if scope=='user':return Path(os.environ.get('FLATPAK_USER_DIR',str(Path(os.environ.get('XDG_DATA_HOME',str(Path.home()/'.local/share')))/'flatpak')))/'repo'
 return Path(os.environ.get('FLATPAK_SYSTEM_DIR','/var/lib/flatpak'))/'repo'

def check_named_remote(scope,name,url,fingerprint):
 names=command('flatpak','remotes','--'+scope,'--columns=name').stdout.splitlines()
 if name not in names:return False
 repo=repo_path(scope)
 def setting(key):return command('ostree',f'--repo={repo}','config','get',f'remote "{name}".{key}').stdout.strip()
 if setting('url').rstrip('/')!=url.rstrip('/') or any(setting(key)!='true' for key in ['gpg-verify','gpg-verify-summary']):
  raise ValueError(f'Existing {name} remote has a different URL or disabled verification; it was not modified')
 keys=command('ostree',f'--repo={repo}','remote','gpg-list-keys',name).stdout
 if re.findall(r'^Key: ([A-F0-9]+)$',keys,re.M)!=[fingerprint]:raise ValueError('Existing remote trusts a different key set; it was not modified')
 return True

def install(scope=None,dry_run=False,trust=Trust()):
 if platform.machine()!='x86_64':raise ValueError('This update channel is verified only for x86_64')
 existing=installations()
 selected=existing[0][0] if existing else (scope or 'user')
 if scope and selected!=scope:raise ValueError(f'The existing app is installed --{selected}; refusing to create a duplicate --{scope} installation')
 current=None;origin=existing[0][1] if existing else None
 if existing:
  current=command('flatpak','info','--'+selected,'--show-commit',APP,'stable').stdout.strip()
  if origin!=REMOTE and current!=R2:raise ValueError('Existing app is neither the known r2 bundle nor this remote; review its provenance before changing origin')
 if APP in command('flatpak','ps','--columns=application').stdout.splitlines():raise ValueError('Quit Airdrop completely before migrating/updating; no running process was killed')
 with tempfile.TemporaryDirectory(prefix='airdrop-flatpak-trust-') as directory:
  temp=Path(directory);descriptor,receipt=verify_channel(trust,temp)
  trusted=check_named_remote(selected,REMOTE,trust.base+'flatpak/',trust.fingerprint)
  runtime=temp/'flathub.flatpakrepo';fetch('https://dl.flathub.org/repo/flathub.flatpakrepo',runtime)
  runtime_config=configparser.ConfigParser(interpolation=None);runtime_config.read(runtime)
  if runtime_config['Flatpak Repo']['Url']!='https://dl.flathub.org/repo/':raise ValueError('Unexpected runtime repository URL')
  load_key(base64.b64decode(runtime_config['Flatpak Repo']['GPGKey'],validate=True),temp/'flathub.gpg',FLATHUB_KEY)
  runtime_trusted=check_named_remote(selected,'flathub','https://dl.flathub.org/repo/',FLATHUB_KEY)
  if existing:
   location=Path(command('flatpak','info','--'+selected,'--show-location',APP,'stable').stdout.strip())/'files'
   installed_version=json.loads((location/'lib/airdrop-linux/server/package.json').read_text())['version']
   if semver(installed_version)>semver(receipt['version']):raise ValueError('Refusing to downgrade a newer installed application')
   marker=location/'share/airdrop-linux/distribution.json'
   if marker.exists():
    installed=json.loads(marker.read_text())
    if semver(installed['version'])==semver(receipt['version']) and installed['revision']>receipt['revision']:raise ValueError('Refusing to downgrade a newer installed repository revision')
  print(f'Verified signing identity {trust.fingerprint}; target {receipt["version"]} revision {receipt["revision"]}; scope --{selected}',flush=True)
  if dry_run:return receipt
  if not runtime_trusted:command('flatpak','remote-add','--'+selected,'flathub',runtime)
  if not trusted:command('flatpak','remote-add','--'+selected,REMOTE,descriptor)
  # No --if-not-exists, --no-gpg-verify, --allow-downgrade, remote-modify,
  # override, uninstall or --delete-data is used by this installer.
  visible=command('flatpak','remote-info','--'+selected,'--arch=x86_64','--show-commit',REMOTE,APP+'//stable').stdout.strip()
  if visible!=receipt['commit']:raise ValueError('Remote head changed during preflight; retry, no app was changed')
  if existing and origin==REMOTE:command('flatpak','update','--'+selected,'--noninteractive',APP+'//stable')
  else:command('flatpak','install','--'+selected,'--noninteractive',*(['--reinstall'] if existing else []),REMOTE,APP+'//stable')
  actual=command('flatpak','info','--'+selected,'--show-commit',APP,'stable').stdout.strip()
  if actual!=receipt['commit']:raise RuntimeError('Installed commit does not match the verified channel')
  assert len(installations())==1
  print('Installed the verified commit. Shared files, desktop preferences and Tailscale state retain the same application ID and private data directory.')
  return receipt

def main():
 p=argparse.ArgumentParser(description=__doc__);scope=p.add_mutually_exclusive_group();scope.add_argument('--user',action='store_true');scope.add_argument('--system',action='store_true');p.add_argument('--dry-run',action='store_true');a=p.parse_args()
 if os.geteuid()==0:p.error('Run as your desktop user; Flatpak requests authorization for system changes')
 try:install('user' if a.user else 'system' if a.system else None,a.dry_run)
 except (ValueError,RuntimeError,OSError,KeyError) as error:print('Not installed: '+str(error),file=sys.stderr);return 1
 return 0
if __name__=='__main__':sys.exit(main())
