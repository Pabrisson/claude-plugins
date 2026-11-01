# Video tools: painted areas, keyframes, the local tools, Kie's edits

Read it before a video edit (Inpaint, Object swap, Face swap, Clean up, Custom edit, Restyle, Relight, Recolor), a tool
done on this machine (Reframe, FPS boost, SDR to HDR, Depth map, Remove background), Lip sync or Speech to video.
`media.mjs` means `node "${CLAUDE_SKILL_DIR}/engine/media.mjs"`, as in SKILL.md.

Contents: a painted area · a keyframe, then the shot (Aleph 2) · done here, free · the video edits on Kie · lip sync ·
speech to video

- **A painted area** (image Inpaint, video Inpaint, Object swap, Clean up): the image or a frame with the area in
  translucent magenta (`--in sketch=<file>`). For an image Inpaint, `--in matte=<file>` (white where painted, black
  elsewhere) lays the model's result back on the original inside that area only, so the rest keeps its pixels (the
  dashboard makes both files; the matte is never sent; `--field outside=model` keeps the model's whole image). A
  painted frame is an image beside the video: of the video models, only Seedance takes one (the command names it
  when the chosen model cannot). A video sent to Seedance goes through Seedance 2.0 Mini, 4 s or longer (the command
  refuses a shorter one, free): it remakes the shot at its length. Seedance 2.5 edits no video through OpenRouter yet (it
  asks a length OpenRouter refuses): it stays among the other models, with Seedance 2.0 and 2.0 Fast, for the day it does. Seedance refuses, free, any image that may show a real person
  (`PrivacyInformation`): a painted frame with someone in it, a face photo for video Face swap. Say so and offer FLUX
  Video Edit or Aleph 2 with words only (no painted frame), or an illustrated face.
- **A keyframe, then the shot (Aleph 2).** Object swap, Face swap and video Inpaint go to Aleph 2 by a keyframe: the
  only edit through OpenRouter that keeps the video and changes just the subject, a character too. Clean up, Custom
  edit, Restyle, Relight and Recolor take one on Aleph 2 as well. Two calls, each with its own estimate and yes:
  1. `video --tool object-swap --in video=<file> --field old="the girl" --field element=@Papi --frame <seconds>`: the
     frame at that time edited as an image (Seedream 5.0 Flash, about $0.02; `--keyframe-model <image model>` for
     another), with the tool's Elements, painted area and references. Look at it (Read) and show it before going on.
  2. The same with `--in keyframe=<that image> --frame <seconds>` (Aleph 2, $0.28 a second, $1.40 at least; a source
     of 2 to 30 s under 16 MB): Aleph carries the change through the whole shot. Without a keyframe Aleph 2 refuses
     these three tools, and a keyframe goes to no other model (OpenRouter has no other that takes one).
  The user's own image can be the keyframe (the dashboard's « Your image », from the computer or the Library): step 2
  straight with it; the Element or photos are then not asked, the keyframe carries the change.
- **Done here, free** (`provider: local`, no estimate to approve): Reframe, FPS boost (`--field target=60|120|slow2|slow4`),
  SDR to HDR (an HDR10 conversion, it adds no detail; `--field peak=600|1000|1600`), Depth map (about 0.3 s a frame)
  and Remove background (about 4 s a frame: a 5 s clip takes some minutes; `--field background=transparent|green|black|white`,
  transparent gives a WebM to preview and a ProRes 4444 `.mov` for editing software). Run the long ones in the
  background.

## The video edits on Kie

On Kie, the video edits (Custom edit, Restyle, Object swap,
Clean up, Inpaint, Face swap, Relight, Recolor) go to Seedance 2.5 first, which takes the video, the Elements'
images and up to 1080p, then Kling 4.0 (it remakes the shot from the video at the source's length, cheaper, Elements
beside it), Kling 3.0 Omni Transformation and Wan 2.7 Video Edit; no Aleph 2 there, so no keyframe
step. Object swap also runs on Wan 2.2 Animate Replace (not recommended, $0.03–0.06 a second, 480p to 720p): the
person of the video becomes the one of an Element's main view or of one photo, motion and expressions kept, no prompt
(the « Replace » words and a painted area do nothing there).

- **Lip sync** (Edit, Kie only): `video --tool lip-sync --in video=<someone speaking> --in audio=<the new voice>`.
  Volcengine (recommended, $0.04 a second of the voice) keeps the video, no prompt; it lasts as long as the voice
  (trimmed or looped); `--option mode=basic` for a complex scene (several people, cuts), `separate_vocal=on` to clean
  the voice first. Its other models: Seedance 2.0 remakes the shot from the video and the voice as references (4–15 s,
  input and output seconds billed), and the talking heads (Kling AI Avatar, InfiniTalk, OmniHuman) start from one frame
  of the video (`--frame <seconds>`, 0 by default): the motion is new. A photo that speaks is Talking avatar.
- **Speech to video** (Create): `video --tool speech-to-video --in first_frame=<image> --in audio=<voice or song>`, its
  words optional: whoever is in it speaks or sings, the scene moves with the sound, as long as it lasts. Kie: Wan 2.2
  Speech to Video (recommended, 480p/580p/720p, 2.5 to 7.5 s: a longer sound is refused, cut it), Seedance 2.0 (4–15 s),
  Wan 2.7, and the talking heads (Seedance takes the image as a reference beside the sound: Kie refuses a first frame with it); OpenRouter: Wan 2.7 (billed 5 s at least), HeyGen Avatar IV.
