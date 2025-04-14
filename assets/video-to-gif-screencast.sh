#!/bin/sh

ffmpeg -i Screencast*.webm -vf scale=800:-1 video.webm && \
  ffmpeg -y -i video.webm -vf palettegen palette.png && \
  ffmpeg -y -i video.webm -i palette.png -filter_complex paletteuse -r 10 screencast.gif && \
  rm video.webm palette.png
