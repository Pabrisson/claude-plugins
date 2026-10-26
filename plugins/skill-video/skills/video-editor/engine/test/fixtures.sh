#!/bin/sh
# Builds the two ~60 s 1920×1080 test videos (a test pattern, no face) next to this script:
# speech.mp4 (French synthetic voice, pauses of varied lengths) and silent.mp4 (same pattern, silent track),
# plus the images the demo specs use.
set -e
cd "$(dirname "$0")"
# assets/: two logos and a photo for the demo specs
mkdir -p assets
[ -f assets/photo.png ] || {
  ffmpeg -y -v error -f lavfi -i color=c=0x2563eb:s=512x512 -vf "format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lt(hypot(X-256,Y-256),230),255,0)'" -frames:v 1 assets/a.png
  ffmpeg -y -v error -f lavfi -i color=c=0xf97316:s=512x512 -vf "format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lt(max(abs(X-256),abs(Y-256)),200),255,0)'" -frames:v 1 assets/b.png
  ffmpeg -y -v error -f lavfi -i testsrc2=s=1200x800 -frames:v 1 assets/photo.png
}
[ -f speech.mp4 ] && [ -f silent.mp4 ] && exit 0
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

text="[[slnc 1200]] Bonjour, et bienvenue dans ce test de montage. [[slnc 300]] \
Cette vidéo sert à vérifier les coupes automatiques. [[slnc 1200]] \
Entre chaque phrase, il y a une pause de longueur différente. [[slnc 500]] \
Certaines sont courtes, [[slnc 250]] d'autres sont beaucoup plus longues. [[slnc 1800]] \
Le moteur doit garder une petite respiration, puis couper le reste. [[slnc 700]] \
Avec le pack shorts, la vidéo devient plus courte et plus rapide. [[slnc 1000]] \
Sans pack, elle reste entière, mais elle est quand même transcrite. [[slnc 400]] \
Voici quelques chiffres pour la transcription : douze, cent vingt-trois, et mille deux cents. [[slnc 1500]] \
Le rendu doit être rapide, sinon la boucle de retours devient pénible. [[slnc 600]] \
On teste aussi les virgules, [[slnc 350]] les hésitations, [[slnc 450]] et les fins de phrases. [[slnc 2000]] \
Un bon montage enlève les silences, mais il garde le sens. [[slnc 900]] \
Il faut aussi que la voix reste naturelle, sans clic entre les morceaux. [[slnc 1300]] \
Une dernière phrase, pour finir proprement. [[slnc 800]] Merci, et à bientôt. [[slnc 1500]]"
if command -v say >/dev/null; then
  voice="$tmp/voice.aiff"
  say -v Thomas -o "$voice" "$text"
else
  # Linux, Windows: espeak-ng, the same pauses as SSML breaks
  voice="$tmp/voice.wav"
  espeak-ng -m -v fr -w "$voice" "$(printf %s "$text" | sed 's/\[\[slnc \([0-9]*\)\]\]/<break time="\1ms"\/>/g')"
fi

ffmpeg -y -v error -f lavfi -i testsrc=size=1920x1080:rate=30 -i "$voice" -shortest \
  -c:v libx264 -preset veryfast -crf 30 -pix_fmt yuv420p -c:a aac -b:a 128k -ar 48000 speech.mp4
ffmpeg -y -v error -f lavfi -i testsrc=size=1920x1080:rate=30:duration=60 -f lavfi -i anullsrc=r=48000:cl=stereo -shortest \
  -c:v libx264 -preset veryfast -crf 30 -pix_fmt yuv420p -c:a aac -b:a 128k silent.mp4
ls -lh speech.mp4 silent.mp4
