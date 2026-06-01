.PHONY: demo clean-demo

# Regenerate demo.gif + demo.mp4 from demo.tape (needs vhs and ffmpeg).
# scripts/make-demo.sh records with VHS, re-recording if it catches a torn
# (half-rendered) frame, then downscales + palette-optimizes the output.
demo:
	bash scripts/make-demo.sh

clean-demo:
	rm -f demo_raw.gif demo.gif demo.mp4
