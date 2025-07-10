#!/usr/bin/env node
/**
 * CLI tool for tagging audio files with AI content metadata
 * Part of AI Content Tagging Tools
 */

const { Command } = require('commander');
const ID3AudioHandler = require('../lib/formats/id3-audio');
const { createMetadata } = require('../lib/core/metadata');
const fs = require('fs').promises;
const path = require('path');

const program = new Command();

program
  .name('tag-audio')
  .description('Tag audio files with AI content metadata')
  .version('1.0.0');

program
  .argument('<input>', 'Input audio file path')
  .option('-o, --output <path>', 'Output file path (default: input-tagged.ext)')
  .option('-a, --author <name>', 'Content author')
  .option('-d, --description <text>', 'Content description')
  .option('--origin <type>', 'Content origin (ai-generated, human-created, hybrid)', 'human-created')
  .option('--model <name>', 'AI model used for generation')
  .option('--license <type>', 'Content license (e.g., CC-BY-4.0, MIT, Proprietary)')
  .option('--prompt <text>', 'Generation prompt (for AI-generated content)')
  .option('--no-checksum', 'Skip checksum generation')
  .option('--sign', 'Create digital signature (requires PRIVATE_KEY env var)')
  .option('--no-preserve', 'Don\'t preserve existing ID3 tags')
  .option('-v, --verbose', 'Verbose output')
  .option('-f, --force', 'Overwrite output file if it exists')
  .action(async (input, options) => {
    try {
      if (options.verbose) {
        console.log(`🎵 Tagging audio file: ${input}`);
        console.log(`📋 Options:`, options);
      }
      
      // Validate input file exists
      try {
        await fs.access(input);
      } catch (error) {
        console.error(`❌ Error: Input file not found: ${input}`);
        process.exit(1);
      }
      
      // Validate file extension
      const ext = path.extname(input).toLowerCase();
      const supportedFormats = ['.mp3', '.m4a', '.flac', '.wav', '.aac'];
      if (!supportedFormats.includes(ext)) {
        console.error(`❌ Error: Unsupported audio format: ${ext}`);
        console.error(`   Supported formats: ${supportedFormats.join(', ')}`);
        process.exit(1);
      }
      
      // Determine output path
      const outputPath = options.output || input.replace(/(\.[^.]+)$/, '-tagged$1');
      
      // Check if output file exists (unless force is used)
      if (!options.force) {
        try {
          await fs.access(outputPath);
          console.error(`❌ Error: Output file already exists: ${outputPath}`);
          console.error('   Use --force to overwrite');
          process.exit(1);
        } catch (error) {
          // File doesn't exist, which is what we want
        }
      }
      
      // Create metadata object
      const metadataFields = {
        contentType: 'audio',
        origin: options.origin,
        created: new Date().toISOString()
      };
      
      // Add optional fields
      if (options.author) metadataFields.author = options.author;
      if (options.description) metadataFields.description = options.description;
      if (options.model) metadataFields.model = options.model;
      if (options.license) metadataFields.license = options.license;
      if (options.prompt) metadataFields.prompt = options.prompt;
      
      // Add processing steps for AI-generated content
      if (options.origin === 'ai-generated' && options.model) {
        metadataFields.processingSteps = [
          {
            step: 'generation',
            tool: options.model,
            parameters: options.prompt ? { prompt: options.prompt } : {},
            timestamp: new Date().toISOString()
          }
        ];
      }
      
      const metadata = createMetadata(metadataFields);
      
      if (options.verbose) {
        console.log('📋 Metadata to embed:');
        console.log(JSON.stringify(metadata, null, 2));
      }
      
      // Initialize handler
      const handler = new ID3AudioHandler({
        preserveExisting: options.preserve !== false
      });
      
      // Configure embedding options
      const embedOptions = {
        includeChecksum: options.checksum !== false
      };
      
      // Add signature if requested
      if (options.sign) {
        if (!process.env.PRIVATE_KEY) {
          console.error('❌ Error: --sign requires PRIVATE_KEY environment variable');
          console.error('   Set PRIVATE_KEY to your private key file path or key content');
          process.exit(1);
        }
        embedOptions.privateKey = process.env.PRIVATE_KEY;
        if (options.verbose) {
          console.log('🔐 Digital signature will be added');
        }
      }
      
      // Embed metadata
      if (options.verbose) {
        console.log('⚙️ Embedding metadata...');
      }
      
      const taggedAudio = await handler.embedMetadata(input, metadata, embedOptions);
      
      // Save tagged file
      await fs.writeFile(outputPath, taggedAudio);
      
      console.log(`✅ Audio tagged successfully: ${outputPath}`);
      
      // Verify the tagging if verbose
      if (options.verbose) {
        console.log('🔍 Verifying embedded metadata...');
        const extracted = await handler.extractMetadata(taggedAudio);
        
        if (extracted) {
          console.log('📋 Verification results:');
          console.log(`   Content Type: ${extracted.contentType}`);
          console.log(`   Origin: ${extracted.origin}`);
          console.log(`   Author: ${extracted.author || 'N/A'}`);
          console.log(`   Created: ${extracted.created}`);
          console.log(`   Checksum verified: ${extracted._verified ? '✅' : '❌'}`);
          console.log(`   Signature valid: ${extracted._signatureValid ? '✅' : '❌'}`);
        } else {
          console.log('❌ Warning: Could not extract metadata for verification');
        }
      }
      
      // Show file size comparison
      const originalStats = await fs.stat(input);
      const taggedStats = await fs.stat(outputPath);
      const sizeDiff = taggedStats.size - originalStats.size;
      
      if (options.verbose) {
        console.log(`📊 File size: ${originalStats.size} → ${taggedStats.size} bytes (+${sizeDiff} bytes)`);
      }
      
    } catch (error) {
      console.error('❌ Error tagging audio:', error.message);
      if (options.verbose) {
        console.error('📊 Stack trace:', error.stack);
      }
      process.exit(1);
    }
  });

// Add subcommand for extracting metadata
program
  .command('extract <input>')
  .description('Extract AI metadata from audio file')
  .option('-f, --format <type>', 'Output format (json, yaml, table)', 'table')
  .option('-o, --output <path>', 'Save output to file')
  .option('-v, --verbose', 'Verbose output')
  .action(async (input, options) => {
    try {
      if (options.verbose) {
        console.log(`🔍 Extracting metadata from: ${input}`);
      }
      
      // Check file exists
      await fs.access(input);
      
      const handler = new ID3AudioHandler();
      const metadata = await handler.extractMetadata(input);
      
      if (!metadata) {
        console.log('❌ No AI metadata found in file');
        process.exit(1);
      }
      
      let output;
      
      switch (options.format) {
        case 'json':
          output = JSON.stringify(metadata, null, 2);
          break;
          
        case 'yaml':
          // Simple YAML-like output
          output = Object.entries(metadata)
            .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`)
            .join('\n');
          break;
          
        case 'table':
        default:
          output = '📋 AI Content Metadata\n';
          output += '='.repeat(50) + '\n';
          output += `Content Type: ${metadata.contentType}\n`;
          output += `Origin: ${metadata.origin}\n`;
          output += `Author: ${metadata.author || 'N/A'}\n`;
          output += `Created: ${metadata.created}\n`;
          output += `Description: ${metadata.description || 'N/A'}\n`;
          output += `License: ${metadata.license || 'N/A'}\n`;
          if (metadata.model) output += `Model: ${metadata.model}\n`;
          if (metadata.prompt) output += `Prompt: ${metadata.prompt}\n`;
          output += `Checksum verified: ${metadata._verified ? '✅' : '❌'}\n`;
          output += `Signature valid: ${metadata._signatureValid ? '✅' : '❌'}\n`;
          break;
      }
      
      if (options.output) {
        await fs.writeFile(options.output, output);
        console.log(`✅ Metadata saved to: ${options.output}`);
      } else {
        console.log(output);
      }
      
    } catch (error) {
      console.error('❌ Error extracting metadata:', error.message);
      process.exit(1);
    }
  });

// Add subcommand for removing metadata
program
  .command('remove <input>')
  .description('Remove AI metadata from audio file')
  .option('-o, --output <path>', 'Output file path (default: input-clean.ext)')
  .option('-f, --force', 'Overwrite output file if it exists')
  .option('-v, --verbose', 'Verbose output')
  .action(async (input, options) => {
    try {
      if (options.verbose) {
        console.log(`🗑️ Removing AI metadata from: ${input}`);
      }
      
      // Check file exists
      await fs.access(input);
      
      const outputPath = options.output || input.replace(/(\.[^.]+)$/, '-clean$1');
      
      // Check if output exists
      if (!options.force) {
        try {
          await fs.access(outputPath);
          console.error(`❌ Error: Output file already exists: ${outputPath}`);
          console.error('   Use --force to overwrite');
          process.exit(1);
        } catch (error) {
          // File doesn't exist, which is what we want
        }
      }
      
      const handler = new ID3AudioHandler();
      
      // Check if file has AI metadata
      const hasMetadata = await handler.hasMetadata(input);
      if (!hasMetadata) {
        console.log('ℹ️ No AI metadata found to remove');
        // Copy file as-is
        const original = await fs.readFile(input);
        await fs.writeFile(outputPath, original);
      } else {
        // Remove metadata
        const cleanAudio = await handler.removeMetadata(input);
        await fs.writeFile(outputPath, cleanAudio);
        
        // Verify removal
        const stillHasMetadata = await handler.hasMetadata(cleanAudio);
        if (stillHasMetadata) {
          console.log('⚠️ Warning: Some AI metadata may still remain');
        }
      }
      
      console.log(`✅ Clean audio saved: ${outputPath}`);
      
      if (options.verbose) {
        const originalStats = await fs.stat(input);
        const cleanStats = await fs.stat(outputPath);
        const sizeDiff = originalStats.size - cleanStats.size;
        console.log(`📊 File size: ${originalStats.size} → ${cleanStats.size} bytes (-${sizeDiff} bytes)`);
      }
      
    } catch (error) {
      console.error('❌ Error removing metadata:', error.message);
      process.exit(1);
    }
  });

// Add subcommand for validating files
program
  .command('validate <input>')
  .description('Validate AI metadata in audio file')
  .option('-v, --verbose', 'Verbose output')
  .action(async (input, options) => {
    try {
      if (options.verbose) {
        console.log(`🔍 Validating: ${input}`);
      }
      
      await fs.access(input);
      
      const handler = new ID3AudioHandler();
      const metadata = await handler.extractMetadata(input);
      
      if (!metadata) {
        console.log('❌ No AI metadata found');
        process.exit(1);
      }
      
      console.log('✅ AI metadata found and validated');
      console.log(`📋 Content: ${metadata.contentType} from ${metadata.origin}`);
      console.log(`🔒 Integrity: ${metadata._verified ? 'Verified' : 'Failed'}`);
      console.log(`✍️ Signature: ${metadata._signatureValid ? 'Valid' : 'Invalid/None'}`);
      
      if (options.verbose) {
        console.log('\n📋 Full metadata:');
        console.log(JSON.stringify(metadata, null, 2));
      }
      
    } catch (error) {
      console.error('❌ Validation failed:', error.message);
      process.exit(1);
    }
  });

// Add help examples
program.addHelpText('after', `
Examples:
  $ tag-audio song.mp3 --author "AI Studio" --origin ai-generated
  $ tag-audio track.mp3 -o tagged-track.mp3 --model "MusicLM" --sign
  $ tag-audio extract music.mp3 --format json
  $ tag-audio remove tagged-music.mp3 -o clean-music.mp3
  $ tag-audio validate tagged-music.mp3

Environment Variables:
  PRIVATE_KEY    Path to private key file or key content for signing

Supported Formats:
  .mp3, .m4a, .flac, .wav, .aac
`);

program.parse();
