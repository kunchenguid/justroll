Output demo_raw.gif

Require ffmpeg
Require node

Set Shell "bash"
Set FontSize 50
Set Width 2750
Set Height 1625
Set Padding 50
Set Theme "Catppuccin Mocha"

Env JUSTROLL_TELEMETRY "0"

# Off-screen setup: a clean prompt, a short tmp recordings dir, and a `justroll`
# shim that drives the real TUI through --demo (mock devices + synthetic engine,
# records nothing) so the run is deterministic.
Hide
Type 'export PS1="$ " && export TMPDIR=/tmp && rm -rf /tmp/justroll-demo && justroll() { node bin/justroll.js --demo "$@"; } && clear'
Enter
Sleep 1s
Show

# --- The one command ---
Sleep 800ms
Type 'justroll "Tutorial Take 1"'
Sleep 1.2s
Enter

# Step 1/4 - Microphone. The live meter animates so you can confirm the mic
# before you ever hit record.
Sleep 2.5s
Up
Sleep 900ms
Down
Sleep 1.6s
Enter

# Step 2/4 - Cameras. Select the capture card.
Sleep 1.4s
Space
Sleep 1.2s
Enter

# Step 3/4 - Screens. Screen 0 is pre-selected; add screen 1 too.
Sleep 1.3s
Down
Sleep 700ms
Space
Sleep 1.2s
Enter

# Step 4/4 - Review. Three files, each carrying the same RODE track for sync.
Sleep 3s
Enter

# Recording. REC timer, per-source stats, and the big live waveform.
Sleep 7.5s

# Stop cleanly -> finalize -> summary.
Ctrl+C
Sleep 3.5s
