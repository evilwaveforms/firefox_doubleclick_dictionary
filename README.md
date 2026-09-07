<p align="center">
  <img src="extension/icons/dictionary.svg" alt="Dictionary" width="96" height="96">
</p>

<h1 align="center">Double-click Dictionary for Firefox</h1>

A lightweight Firefox extension that shows English-language definitions when you double-click a word. It supports English, Finnish, Swedish, German, French, and Spanish entries. Definitions, phonetics, and examples come from the separately deployed [dictionary data project](https://github.com/evilwaveforms/doubleclick_dictionary_data), which processes Wiktextract data into versioned static assets.

## Development

Requires Node.js 20 or newer. The extension supports Firefox 140 and newer on desktop and Firefox 142 and newer on Android.

```sh
npm install
npm test
```

Set `baseUrl` in `dictionary.config.json` to the versioned Workers Static Assets URL. Use `http://localhost:8787/v2` while developing against `npx wrangler dev` in the data repository. The build adds the corresponding Firefox host permission to the generated manifest. When the dictionary schema changes incompatibly, deploy the new versioned directory before updating this URL.

To load the extension locally:

1. Run `npm run build`.
2. Open `about:debugging#/runtime/this-firefox` in Firefox.
3. Select **Load Temporary Add-on**.
4. Select `dist/manifest.json`.

Run `npm run package` to create `doubleclick-dictionary.zip` for submission or manual installation.

## Release

For an ordinary dictionary refresh that does not change its JSON format, rebuild and deploy the data repository without changing the extension.

For an incompatible dictionary format change:

1. Increment `SCHEMA_VERSION` in `src/dictionary.ts` to match the data processor.
2. Change `baseUrl` in `dictionary.config.json` to the new versioned path, such as `/v3`.
3. Deploy and verify the new dictionary version before releasing the extension.
4. Build and test the extension:

   ```sh
   npm test
   npm run package
   ```

5. Test `doubleclick-dictionary.zip`, then submit it to the extension store.

Do not release an extension that points to a dictionary schema which has not been deployed yet. The data repository retains the previous schema for users whose extension has not updated.

## Design

- The content script only listens for double-clicks and renders one small popup. It does not scan or observe the page.
- Dictionary requests run in a non-persistent background script so pages do not receive dictionary host permissions.
- The background script fetches dictionary metadata once, hashes each language and word pair, and downloads only its compact shard.
- Successful and not-found lookups use a bounded in-memory LRU cache. Concurrent requests for the same word share one network request.
- The toolbar settings menu stores the selected theme and lookup language preference locally.
- Language is included in the lookup protocol and shard key.
- Automatic language selection first uses the nearest HTML `lang` declaration. If the page does not declare a supported language, Firefox's built-in detector examines up to 1,000 characters of nearby text locally and is used only when its result is reliable. Ambiguous results fall back to English.
- The extension uses the selected word and detected language locally to choose a dictionary shard and requests only that shard. It does not send the word, page URL, or surrounding text, or write lookup history to persistent storage. Firefox reports this lookup-derived request as the `websiteContent` data permission during installation.

## Current limitations

- Definitions are written in English because the data is extracted from English Wiktionary.
- Firefox does not run extensions on protected browser pages such as `about:` pages.
- No pronunciation audio.

## License

The extension source code is available under the [MIT License](LICENSE). Dictionary definitions and examples are derived from [Wiktionary](https://en.wiktionary.org/) using Wiktextract, modified for this extension, and distributed separately under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Each definition popup links to its source entry; the deployed dictionary includes the complete attribution, license, and modification notice.
