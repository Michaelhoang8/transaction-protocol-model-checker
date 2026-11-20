# Recorded report review

[Watch or download the MP4](walkthrough.mp4)

This is a continuous **automated browser walkthrough** of the generated report,
recorded while scrolling through its actual sections. It demonstrates the measured
results and source artifacts; it is not footage of a person manually developing
the project. No timing results or UI states were fabricated for the recording.
The report describes synthetic workloads, with measurements from actual executions.

The video is silent. Full-resolution [section screenshots](../screenshots) retain
tables that may need pausing or zooming. [Capture manifest](captures.json) records
the capture time, viewport and screenshot hashes.

To regenerate media after rebuilding the report (optional):

```sh
python -m pip install -r requirements-media.txt
python -m playwright install chromium ffmpeg
python scripts/capture_report.py
```

System FFmpeg must be on PATH. On Windows the script uses installed Microsoft Edge;
otherwise it uses Playwright Chromium. Rebuilding measurements changes the report;
recapture media to keep screenshots aligned with those new results.
