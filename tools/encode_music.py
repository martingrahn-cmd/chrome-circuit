"""Turns the soundtrack's masters (WAV, any rate) into the game's MP3s,
assets/music/{slug}.mp3, every song brought to the same loudness so none is
louder than the rest when the screens change.

    python3 tools/encode_music.py <folder of WAVs>

Needs ffmpeg on the PATH, or FFMPEG pointing at one (pip install
imageio-ffmpeg brings a static build). The file name maps to the slug the
game knows the song by (src/music.js): "Highway Hustle.wav" -> highway-hustle.
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

FFMPEG = os.environ.get('FFMPEG', 'ffmpeg')
OUT = Path(__file__).resolve().parent.parent / 'assets' / 'music'
# EBU R128: a little under what streaming services aim for, so the
# sound effects still sit on top.
TARGET = dict(I=-16, TP=-1.5, LRA=11)


def slug(name):
    return re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')


def measure(src):
    norm = ':'.join(f'{k}={v}' for k, v in TARGET.items())
    err = subprocess.run([FFMPEG, '-hide_banner', '-nostats', '-i', str(src),
                          '-af', f'loudnorm={norm}:print_format=json', '-f', 'null', '-'],
                         capture_output=True, text=True).stderr
    return json.loads(err[err.rindex('{'):err.rindex('}') + 1])


def encode(src, dst):
    m = measure(src)
    norm = ':'.join(f'{k}={v}' for k, v in TARGET.items())
    af = (f'loudnorm={norm}:linear=true:measured_I={m["input_i"]}:measured_TP={m["input_tp"]}'
          f':measured_LRA={m["input_lra"]}:measured_thresh={m["input_thresh"]}'
          f':offset={m["target_offset"]},aresample=44100')
    subprocess.run([FFMPEG, '-hide_banner', '-loglevel', 'error', '-y', '-i', str(src),
                    '-af', af, '-c:a', 'libmp3lame', '-q:a', '5', '-map_metadata', '-1', str(dst)],
                   check=True)


def main(folder):
    OUT.mkdir(parents=True, exist_ok=True)
    for src in sorted(Path(folder).glob('*.wav')):
        dst = OUT / f'{slug(src.stem)}.mp3'
        encode(src, dst)
        print(f'{src.name} -> {dst.name} ({dst.stat().st_size // 1024} KB)')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else '.')
