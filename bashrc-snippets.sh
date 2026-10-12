# Airdrop helpers are installed in ~/.local/bin by install.sh.
# Add this snippet once to ~/.bashrc for manual installations.
# Use the executable rather than duplicating transfer/ZIP logic in shell functions.
unalias airdrop copy-clipboard paste-clipboard 2>/dev/null || true
unset -f airdrop copy-clipboard paste-clipboard 2>/dev/null || true
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) export PATH="$HOME/.local/bin:$PATH" ;;
esac
