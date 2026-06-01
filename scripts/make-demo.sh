#!/usr/bin/env bash
#
# Build demo.gif + demo.mp4 from demo.tape.
#
# VHS samples the terminal grid on a timer, so it can occasionally capture a
# half-rendered (torn) frame while Ink repaints the live recording dashboard -
# the waveform collapses and the box's lower rows/hint bar vanish for one frame,
# which reads as a flicker. We detect those takes and re-record until clean:
# in the back half of the run (review -> recording -> summary) the hint bar is
# always on screen, so any frame where that strip goes dark is a torn frame.
#
# Needs: vhs, ffmpeg, ffprobe.

set -eu
cd "$(dirname "$0")/.."

MAX_ATTEMPTS=6
# Single ffmpeg pass: downscale, tighten pace ~1.2x, then palette-optimize the gif.
GIF_FILTER="[0:v]scale=1100:650:flags=lanczos,setpts=PTS/1.2,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=sierra2_4a"
MP4_FILTER="scale=1100:650:flags=lanczos,setpts=PTS/1.2"

build_gif() {
  ffmpeg -loglevel error -i demo_raw.gif -filter_complex "$GIF_FILTER" -r 15 -y demo.gif
}

# Count torn frames: mean brightness of the hint-bar strip per frame over the
# back half of demo.gif. The hint bar is static text there (~40-50); a torn
# frame blanks it (~0). Threshold 15 separates them cleanly.
count_tears() {
  local dur start
  dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 demo.gif)
  start=$(awk "BEGIN{printf \"%.2f\", $dur * 0.5}")
  ffmpeg -loglevel info -ss "$start" -i demo.gif \
    -vf "crop=360:28:30:512,signalstats,metadata=mode=print:file=-" -f null /dev/null 2>/dev/null \
    | grep -o "lavfi.signalstats.YAVG=[0-9.]*" | cut -d= -f2 \
    | awk '$1 < 15 { c++ } END { print c + 0 }'
}

for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
  echo "==> VHS capture attempt $attempt/$MAX_ATTEMPTS"
  vhs demo.tape
  build_gif
  tears=$(count_tears)
  if [ "$tears" -eq 0 ]; then
    echo "==> clean capture, building mp4"
    ffmpeg -loglevel error -i demo_raw.gif -vf "$MP4_FILTER" \
      -c:v libx264 -pix_fmt yuv420p -movflags +faststart -r 30 -y demo.mp4
    rm -f demo_raw.gif
    echo "==> wrote demo.gif + demo.mp4"
    exit 0
  fi
  echo "==> $tears torn frame(s) detected; re-recording"
done

echo "ERROR: no clean capture after $MAX_ATTEMPTS attempts" >&2
exit 1
