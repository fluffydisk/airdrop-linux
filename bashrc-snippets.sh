# Airdrop — terminal helper functions
# Append this block to the end of ~/.bashrc, then run: source ~/.bashrc
#
# Clipboard commands use wl-clipboard on Wayland:
#   sudo zypper install wl-clipboard   (openSUSE)
#   sudo apt install wl-clipboard      (Debian/Ubuntu)
# On X11, replace wl-copy/wl-paste with xclip -selection clipboard -i/-o.

airdrop() {
  if [ -z "$1" ]; then
    echo "Usage: airdrop <file>"
    return 1
  fi

  local src="$1"
  local base
  base="$(basename "$src")"
  local name="${base%.*}"
  local ext="${base##*.}"
  if [ "$name" = "$ext" ]; then
    ext=""
  else
    ext=".${ext}"
  fi

  local dest="$HOME/AirdropShare/$base"
  local counter=1

  while [ -e "$dest" ]; do
    dest="$HOME/AirdropShare/${name} (${counter})${ext}"
    counter=$((counter + 1))
  done

  cp "$src" "$dest" && echo "Copied to AirdropShare: $(basename "$dest")"
}

copy-clipboard() {
  wl-copy < ~/AirdropShare/.clipboard.txt
  echo "Shared clipboard copied to the local clipboard."
}

paste-clipboard() {
  wl-paste > ~/AirdropShare/.clipboard.txt
  echo "Local clipboard sent to AirdropShare."
}
