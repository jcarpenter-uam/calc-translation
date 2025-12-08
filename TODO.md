# TODO before merge

- Language selection on client side
- Fully translated UI

## Things to think about

- I need a way to backfeed if a new language joins the meeting late, priority should be speed to get the new language caught up as fast as possible.
  My best idea is using Qwen-MT-Turbo to backfeed, sending each utterance one at a time going newest->oldest
  While this might get slowing depending on how late someone joins, it is the only way I can think of to preserve the speaker names, and utterance numbers for a final transcript in the new language

- How can I handle someone joining mid utterance?

- I need to account for language hints with the soniox api for better results

- Cache, VTT files will both have to be reworked to allow for multiple languages per session

- Authenticating for a given session allows you access to any language even switching mid meeting

- Liked language dropdown component [here](https://github.com/soniox/soniox_examples/blob/master/speech_to_text/apps/soniox-live-demo/react/src/renderers/translate-to.tsx)
