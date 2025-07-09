#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { Command } = require('commander');
const { ContentMetadata } = require('../lib/core/metadata');

const program = new Command();

program
  .name('tag-content')
  .description('Tag digital content with AI/Human classification metadata')
  .version('0.1.0');

program
  .option('-i, --input <file>', 'input file to tag')
  .option('-o, --output <file>', 'output file (defaults to input + .tagged)')
  .option('--origin <type>', 'content origin: human, ai, or hybrid', 'human')
  .option('--author <name>', 'content author/creator', 'Unknown')
  .option('--license <license>', 'content license (e.g., CC-BY-4.0)')
  .option('--toolchain <tools>', 'tools used for AI content (e.g., GPT-4, DALL-E)')
  .option('--model <model>', 'specific AI model identifier')
  .option('--format <format>', 'output format: sidecar, header, html', 'sidecar')
  .option('--sign', 'add cryptographic signature (requires key setup)')
  .option('-v, --verbose', 'verbose output');

program.action(async (options) => {
  try {
    // Validate required options
    if (!options.input) {
      console.error('Error: Input file is required. Use -i or --input');
      process.exit(1);
    }

    if (!fs.existsSync(options.input)) {
      console.error(`Error: Input file does not exist: ${options.input}`);
      process.exit(1);
    }

    // Read the input file
    const content = fs.readFileSync(options.input);
    if (options.verbose) {
      console.log(`Read ${content.length} bytes from ${options.input}`);
    }

    // Generate metadata
    const metadataOptions = {
      origin: options.origin,
      author: options.author,
      license: options.license,
      toolchain: options.toolchain,
      model_identifier: options.model
    };

    const metadata = ContentMetadata.generateForContent(content, metadataOptions);

    // Validate metadata
    const validation = metadata.validate();
    if (!validation.isValid) {
      console.error(`Error: Invalid metadata - ${validation.error}`);
      process.exit(1);
    }

    if (options.verbose) {
      console.log('Generated metadata:');
      console.log(JSON.stringify(metadata.toObject(), null, 2));
    }

    // Determine output file
    const outputFile = options.output || `${options.input}.tagged`;

    // Generate output based on format
    switch (options.format.toLowerCase()) {
      case 'sidecar':
        await generateSidecarOutput(options.input, outputFile, metadata, options.verbose);
        break;
      case 'header':
        await generateHeaderOutput(options.input, outputFile, metadata, options.verbose);
        break;
      case 'html':
        await generateHTMLOutput(options.input, outputFile, metadata, options.verbose);
        break;
      default:
        console.error(`Error: Unsupported format: ${options.format}`);
        process.exit(1);
    }

    console.log(`✅ Successfully tagged content: ${outputFile}`);
    
    if (options.format === 'sidecar') {
      console.log(`📄 Metadata file: ${outputFile}.meta.xml`);
    }

  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
});

async function generateSidecarOutput(inputFile, outputFile, metadata, verbose) {
  // Copy original file to output
  fs.copyFileSync(inputFile, outputFile);
  
  // Create sidecar metadata file
  const metadataFile = `${outputFile}.meta.xml`;
  const xmlContent = metadata.toXML();
  fs.writeFileSync(metadataFile, xmlContent);
  
  if (verbose) {
    console.log(`Created sidecar file: ${metadataFile}`);
    console.log('Metadata XML:');
    console.log(xmlContent);
  }
}

async function generateHeaderOutput(inputFile, outputFile, metadata, verbose) {
  const originalContent = fs.readFileSync(inputFile, 'utf8');
  const headerValue = metadata.toHTTPHeader();
  
  // For demonstration, we'll add the header as a comment at the top
  const headerComment = `// X-Content-Metadata: ${headerValue}\n`;
  const taggedContent = headerComment + originalContent;
  
  fs.writeFileSync(outputFile, taggedContent);
  
  if (verbose) {
    console.log('HTTP Header format:');
    console.log(`X-Content-Metadata: ${headerValue}`);
  }
}

async function generateHTMLOutput(inputFile, outputFile, metadata, verbose) {
  const originalContent = fs.readFileSync(inputFile, 'utf8');
  const metaTags = metadata.toHTMLMeta();
  
  // Insert meta tags into HTML head section
  let taggedContent = originalContent;
  
  if (originalContent.includes('<head>')) {
    const metaTagsString = metaTags.join('\n  ') + '\n';
    taggedContent = originalContent.replace('<head>', `<head>\n  ${metaTagsString}`);
  } else {
    // If not HTML, add as comments
    const metaComments = metaTags.map(tag => `<!-- ${tag} -->`).join('\n');
    taggedContent = metaComments + '\n' + originalContent;
  }
  
  fs.writeFileSync(outputFile, taggedContent);
  
  if (verbose) {
    console.log('HTML Meta tags:');
    metaTags.forEach(tag => console.log(tag));
  }
}

// Help examples
program.on('--help', () => {
  console.log('');
  console.log('Examples:');
  console.log('  $ tag-content -i article.txt --origin human --author "Jane Doe"');
  console.log('  $ tag-content -i image.jpg --origin ai --toolchain "DALL-E" --format sidecar');
  console.log('  $ tag-content -i page.html --origin hybrid --format html --verbose');
  console.log('');
  console.log('Supported origins:');
  console.log('  human  - Content created entirely by humans');
  console.log('  ai     - Content generated by AI systems'); 
  console.log('  hybrid - Content with both human and AI involvement');
  console.log('');
  console.log('Output formats:');
  console.log('  sidecar - Creates .meta.xml file alongside original');
  console.log('  header  - Embeds as HTTP header comment');
  console.log('  html    - Embeds as HTML meta tags');
});

program.parse();
