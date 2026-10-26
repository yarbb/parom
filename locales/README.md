# Translations
- One JSON file per language, named by BCP 47 code (`en.json`, `ru.json`, `de.json`).
- `en.json` is the source of truth. Missing keys fall back to English.
- Values use ICU MessageFormat: `{name}` placeholders and `{count, plural, one {# file} other {# files}}`. Keep placeholders unchanged. Languages like Russian need `one`, `few`, `many`, `other` forms.
- Do not translate keys, only values. Fill `_meta.language` and `_meta.name` (the language's own name).
- Send translations as a pull request.
