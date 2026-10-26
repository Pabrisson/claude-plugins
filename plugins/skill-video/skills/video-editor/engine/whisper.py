# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "mlx-whisper; sys_platform == 'darwin' and platform_machine == 'arm64'",
#   "faster-whisper; sys_platform != 'darwin' or platform_machine != 'arm64'",
# ]
# ///
"""Word-level transcript of a WAV with Whisper large-v3-turbo, written as JSON (its segments and their words):
mlx-whisper on Apple Silicon, faster-whisper on the CPU everywhere else (an Intel Mac, Linux, Windows).
The vocabulary (names and brands: the style's creator.vocabulary) is the prompt of every 30 s window: mlx-whisper's
own initial prompt reaches the first one only when the previous text is not carried over, and carrying it over loops
on hallucinations. faster-whisper's hotwords reach every window.

  uv run whisper.py <wav> <out.json> <lang> [vocabulary]
"""
import importlib, json, platform, sys

wav, out, lang, vocabulary = (sys.argv[1:] + [''])[:4]
# a sentence, ended: a bare list of names derails the decoding, which carries the list on
vocabulary = vocabulary.strip() and vocabulary.strip().rstrip('.') + '.'
options = dict(language=lang, word_timestamps=True, condition_on_previous_text=False, hallucination_silence_threshold=2)

if sys.platform == 'darwin' and platform.machine() == 'arm64':
    import mlx_whisper

    # the module, not the function of the same name the package exports
    tr = importlib.import_module('mlx_whisper.transcribe')
    if vocabulary:
        # every window's prompt is empty (nothing carried over): it becomes the vocabulary
        decoding = tr.DecodingOptions
        tr.DecodingOptions = lambda prompt=None, **k: decoding(prompt=prompt or vocabulary, **k)
    segments = mlx_whisper.transcribe(wav, path_or_hf_repo='mlx-community/whisper-large-v3-turbo', verbose=False, **options)['segments']
    segments = [s.get('words', []) for s in segments]
else:
    from faster_whisper import WhisperModel

    # ponytail: CPU only, int8; device='cuda' when an NVIDIA GPU with its cuBLAS and cuDNN is there
    found, _ = WhisperModel('large-v3-turbo', device='cpu', compute_type='int8').transcribe(wav, hotwords=vocabulary or None, **options)
    segments = [[{'word': w.word, 'start': w.start, 'end': w.end} for w in s.words or []] for s in found]

# only the words (whisper's own fields hold NaN, which JSON has no word for)
with open(out, 'w') as f:
    json.dump({'segments': [{'words': [{k: w[k] for k in ('word', 'start', 'end')} for w in s]} for s in segments]}, f, default=float)
