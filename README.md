# AI Content Tagging Tools
 
Combat AI model collapse with RFC-compliant content tagging. Professional toolkit for content authenticity, dataset integrity, and provenance tracking. Includes drag-and-drop web interface, CLI utilities, and cryptographic verification.

## Repository Structure

<pre>
ai-content-tagging-tools/
├── README.md
├── package.json
├── .gitignore
├── LICENSE
├── docs/
│   ├── api.md
│   └── examples.md
├── lib/
│   ├── core/
│   │   ├── metadata.js          # Core metadata schema and validation
│   │   ├── crypto.js            # Signature and checksum utilities
│   │   └── constants.js         # Schema constants and enums
│   └── formats/
│       ├── http-headers.js      # HTTP header embedding/parsing
│       ├── sidecar-xml.js       # XML sidecar file handling
│       ├── html-meta.js         # HTML meta tag injection/parsing
│       ├── id3-audio.js         # ID3v2 tag handling for audio
│       └── exif-image.js        # EXIF/XMP handling for images
├── validators/
│   ├── schema-validator.js      # Metadata schema validation
│   ├── signature-validator.js   # Cryptographic signature verification
│   └── integrity-checker.js     # Checksum and integrity validation
├── demo-web/
│   ├── index.html
│   ├── app.js
│   ├── style.css
│   └── server.js                # Simple Express server for demo
├── cli/
│   ├── tag-content.js           # CLI tool to tag content
│   ├── validate-content.js      # CLI tool to validate tagged content
│   └── extract-metadata.js      # CLI tool to extract metadata
├── examples/
│   ├── sample-files/            # Sample files with metadata
│   ├── test-cases/              # Test cases for validation
│   └── schemas/                 # XML/JSON schema files
└── tests/
    ├── unit/
    ├── integration/
    └── fixtures/
</pre>

## Quick Start

### Clone the repository
```bash
git clone https://github.com/yourusername/ai-content-tagging-tools.git
cd ai-content-tagging-tools
```

### Install dependencies
```bash
npm install
```

### Run tests
```bash
npm test
```

### Start web demo
```bash
npm run demo
```

### Use CLI tools
```bash
npx tag-content --input file.txt --origin human --author "Jane Doe"
npx validate-content --input tagged-file.txt
```


## Core Features

- ✅ **Metadata Creation**: Generate RFC-compliant metadata for any content
- ✅ **Multi-Format Support**: HTTP headers, XML sidecars, HTML meta, ID3, EXIF
- ✅ **Cryptographic Validation**: Digital signatures and integrity checking
- ✅ **Web Demo**: Interactive tool for tagging and validating content
- ✅ **CLI Tools**: Command-line utilities for batch processing
- ✅ **Schema Validation**: Ensure metadata compliance with the RFC spec



## Implementation Status

| Component | Status | Description |
| --- | --- | --- |
| Core Metadata | ✅ Complete | Full RFC metadata schema and utilities |
| CLI Tools | ✅ Complete | Tag, validate, extract, and HTML meta tools |
| XML Sidecars | ✅ Complete | Sidecar file generation and parsing |
| HTML Meta Tags | ✅ Complete | Professional injection and extraction tool |
| HTTP Headers | ✅ Complete | Express middleware and parsing |
| Web Demo | ✅ Complete | Interactive demonstration tool |
| Audio ID3 Tags | ⏳ Planned | ID3v2 tag handling |
| Image EXIF/XMP | ⏳ Planned | Image metadata embedding |


## Contributing

This is a reference implementation for an IETF Internet-Draft. Contributions welcome!

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Related

- [IETF Internet-Draft: AI Content Classification System](link-to-draft)
- [RFC Implementation Guidelines](docs/api.md)
