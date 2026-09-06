# Double-click Dictionary for Firefox

A lightweight Firefox extension that shows English definitions when you double-click a word. Definitions, phonetics, and examples come from the separately deployed dictionary data project.

## Development

Requires Node.js 20 or newer. The extension supports Firefox 140 and newer on desktop and Firefox 142 and newer on Android.

```sh
npm install
npm test
```

Set `baseUrl` in `dictionary.config.json` to the Workers Static Assets deployment URL. Keep `http://localhost:8787` while developing against `npx wrangler dev` in the data repository. The build adds the corresponding Firefox host permission to the generated manifest.

To load the extension locally:

1. Run `npm run build`.
2. Open `about:debugging#/runtime/this-firefox` in Firefox.
3. Select **Load Temporary Add-on**.
4. Select `dist/manifest.json`.

Run `npm run package` to create `doubleclick-dictionary.zip` for submission or manual installation.

## Design

- The content script only listens for double-clicks and renders one small popup. It does not scan or observe the page.
- Dictionary requests run in a non-persistent background script so pages do not receive dictionary host permissions.
- The background script fetches dictionary metadata once, hashes each language and word pair, and downloads only its compact shard.
- Successful and not-found lookups use a bounded in-memory LRU cache. Concurrent requests for the same word share one network request.
- Language is included in the lookup protocol and shard key.
- The extension sends the selected word to the configured dictionary host only after a valid word is double-clicked. It does not otherwise collect browsing data or store lookup history. Firefox reports this transmission as the `websiteContent` data permission during installation.

## Current limitations

- English only.
- Firefox does not run extensions on protected browser pages such as `about:` pages.
- No pronunciation audio.

## License

The extension source code is available under the [MIT License](LICENSE). Dictionary definitions and examples are derived from [Wiktionary](https://en.wiktionary.org/) using Wiktextract, modified for this extension, and distributed separately under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Each definition popup links to its source entry; the deployed dictionary includes the complete attribution, license, and modification notice.
