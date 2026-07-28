#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
user_id="$(id -u)"
launch_agents_dir="$HOME/Library/LaunchAgents"
logs_dir="$HOME/Library/Logs/Intero"
plist_path="$launch_agents_dir/com.intero.production.plist"
backup_plist_path="$launch_agents_dir/com.intero.production.backup.plist"

mkdir -p "$launch_agents_dir" "$logs_dir"

escaped_repo_root="$(
  printf '%s' "$repo_root" |
    sed \
      -e 's/&/\\&amp;/g' \
      -e 's/</\\&lt;/g' \
      -e 's/>/\\&gt;/g' \
      -e 's/"/\\&quot;/g'
)"

{
  cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.intero.production</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${escaped_repo_root}/scripts/ops/ensure-production.sh</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${escaped_repo_root}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>300</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${logs_dir}/production-launch.log</string>
  <key>StandardErrorPath</key>
  <string>${logs_dir}/production-launch-error.log</string>
</dict>
</plist>
PLIST
} >"$plist_path"

chmod 600 "$plist_path"
plutil -lint "$plist_path"
launchctl bootout "gui/$user_id/com.intero.production" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$user_id" "$plist_path"
launchctl enable "gui/$user_id/com.intero.production"

{
  cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.intero.production.backup</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${escaped_repo_root}/scripts/ops/backup-production.sh</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${escaped_repo_root}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>3</integer>
    <key>Minute</key>
    <integer>15</integer>
  </dict>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${logs_dir}/production-backup.log</string>
  <key>StandardErrorPath</key>
  <string>${logs_dir}/production-backup-error.log</string>
</dict>
</plist>
PLIST
} >"$backup_plist_path"

chmod 600 "$backup_plist_path"
plutil -lint "$backup_plist_path"
launchctl bootout "gui/$user_id/com.intero.production.backup" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$user_id" "$backup_plist_path"
launchctl enable "gui/$user_id/com.intero.production.backup"

echo "Installed $plist_path"
echo "Installed $backup_plist_path"
echo "OrbStack must remain configured to start at login."
