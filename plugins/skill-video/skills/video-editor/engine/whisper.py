# /// script
# requires-python = ">=3.10"
# dependencies = ["mlx-whisper"]
# ///
"""Word-level transcript of a WAV with mlx-whisper (Apple Silicon), written as JSON (its segments and their words).
The vocabulary (names and brands: the style's creator.vocabulary) is the prompt of every 30 s window: mlx-whisper's
own initial prompt reaches the first one only when the previous text is not carried over, and carrying it over loops
on hallucinations.

  uv run whisper.py <wav> <out.json> <lang> <model> [vocabulary]
"""
import importlib, json, sys

import mlx_whisper

# the module, not the function of the same name the package exports
tr = importlib.import_module('mlx_whisper.transcribe')

wav, out, lang, model, vocabulary = (sys.argv[1:] + [''])[:5]
if vocabulary.strip():
    # a sentence, ended: a bare list of names derails the decoding, which carries the list on
    vocabulary, options = vocabulary.strip().rstrip('.') + '.', tr.DecodingOptions
    # every window's prompt is empty (nothing carried over): it becomes the vocabulary
    tr.DecodingOptions = lambda prompt=None, **k: options(prompt=prompt or vocabulary, **k)
result = mlx_whisper.transcribe(wav, path_or_hf_repo=model, language=lang, word_timestamps=True,
                                condition_on_previous_text=False, hallucination_silence_threshold=2, verbose=False)
# only the words (whisper's own fields hold NaN, which JSON has no word for)
with open(out, 'w') as f:
    json.dump({'segments': [{'words': [{k: w[k] for k in ('word', 'start', 'end')} for w in s.get('words', [])]} for s in result['segments']]}, f, default=float)
