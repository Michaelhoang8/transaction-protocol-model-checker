"""Capture the rendered report and an actual automated browser-review recording.

Requires optional playwright and its ffmpeg runtime. Uses installed Edge on
Windows; elsewhere install Playwright Chromium. System ffmpeg encodes the MP4.
"""
from pathlib import Path
from datetime import datetime, timezone
import argparse, hashlib, json, subprocess, tempfile
from playwright.sync_api import sync_playwright

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1])
    parser.add_argument('--sections',nargs='+',help='HTML IDs in walkthrough order; overrides docs/capture-sections.json')
    args=parser.parse_args(); root=args.root.resolve()
    config=root/'docs/capture-sections.json'
    sections=args.sections or (json.loads(config.read_text()) if config.exists() else
             (['overview','pipeline','correctness','measurements','decision']
              if (root/'src/integer_compiler').exists()
              else ['overview','queries','plans','writes','pagination','methods']))
    images=root/'docs/screenshots'; images.mkdir(exist_ok=True)
    recordings=root/'docs/recordings';recordings.mkdir(exist_ok=True)
    captures=[];errors=[]
    with tempfile.TemporaryDirectory(prefix='portfolio-capture-') as temp, sync_playwright() as pw:
        options={'headless':True}
        if Path('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe').exists(): options['channel']='msedge'
        browser=pw.chromium.launch(**options)
        context=browser.new_context(viewport={'width':1440,'height':1000},device_scale_factor=1,
                                    record_video_dir=temp,record_video_size={'width':1440,'height':1000})
        page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto((root/'docs/report.html').as_uri(),wait_until='networkidle')
        page.evaluate('document.fonts.ready')
        assert page.locator('img').evaluate_all('(imgs)=>imgs.every(i=>i.complete && i.naturalWidth>0)'), 'Broken report image'
        title=page.title()
        for i,section in enumerate(sections,1):
            target=page.locator('#'+section)
            assert target.count()==1, f'Missing/duplicate section {section}'
            page.evaluate('(id)=>document.getElementById(id).scrollIntoView({behavior:"smooth",block:"start"})',section)
            page.wait_for_timeout(900)
            # Section screenshots preserve full tables even when taller than a viewport.
            path=images/f'{i:02d}_{section}.png'
            target.screenshot(path=str(path),animations='disabled')
            captures.append({'path':path.relative_to(root).as_posix(),'section':section,
                             'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
            page.wait_for_timeout(3000)
            box=target.bounding_box()
            if box and box['height']>900:
                page.mouse.wheel(0,min(box['height']-750,800));page.wait_for_timeout(2400)
        video=page.video
        context.close(); source=Path(video.path()); browser.close()
        subprocess.run(['ffmpeg','-y','-loglevel','error','-i',str(source),'-c:v','libx264',
                        '-preset','fast','-crf','22','-pix_fmt','yuv420p','-movflags','+faststart',
                        str(recordings/'walkthrough.mp4')],check=True)
    assert not errors, errors
    manifest={'captured_at_utc':datetime.now(timezone.utc).isoformat(),
              'source':'Actual browser rendering of docs/report.html',
              'recording':'Continuous automated browser review; not manual development footage',
              'viewport':{'width':1440,'height':1000},'page_title':title,
              'report_sha256_normalized_text':hashlib.sha256((root/'docs/report.html').read_text(encoding='utf-8').encode()).hexdigest(),
              'video_sha256':hashlib.sha256((recordings/'walkthrough.mp4').read_bytes()).hexdigest(),
              'captures':captures}
    (recordings/'captures.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
    gallery='# Report screenshots\n\nActual browser captures of the generated technical report.\n'
    for capture in captures:
        gallery+=f"\n## {capture['section'].title()}\n\n![{capture['section']}]({Path(capture['path']).name})\n"
    (images/'README.md').write_text(gallery,encoding='utf-8')
    (recordings/'README.md').write_text('''# Recorded report review

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
''',encoding='utf-8')
    print(json.dumps({'project':root.name,'screenshots':len(captures),'video_bytes':(recordings/'walkthrough.mp4').stat().st_size,'page_errors':errors}))

if __name__=='__main__': main()
