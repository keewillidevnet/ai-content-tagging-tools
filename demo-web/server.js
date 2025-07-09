const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { ContentMetadata } = require('../lib/core/metadata');

const app = express();
const PORT = process.env.PORT || 3000;

// Configure multer for file uploads
const storage = multer.memoryStorage(); // Store files in memory for processing
const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname))); // Serve static files from demo-web directory

// CORS headers for development
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  next();
});

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// API Routes

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'AI Content Tagging Tools',
    version: '0.1.0',
    timestamp: new Date().toISOString()
  });
});

// Tag content endpoint
app.post('/api/tag', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { origin, author, license, toolchain, model_identifier } = req.body;

    // Validate required fields
    if (!origin || !author) {
      return res.status(400).json({ error: 'Origin and author are required fields' });
    }

    // Generate metadata
    const metadataOptions = {
      origin: origin,
      author: author,
      license: license || undefined,
      toolchain: toolchain || undefined,
      model_identifier: model_identifier || undefined
    };

    const metadata = ContentMetadata.generateForContent(req.file.buffer, metadataOptions);

    // Validate metadata
    const validation = metadata.validate();
    if (!validation.isValid) {
      return res.status(400).json({ error: `Invalid metadata: ${validation.error}` });
    }

    // Generate different format outputs
    const outputs = {
      metadata: metadata.toObject(),
      xml: metadata.toXML(),
      httpHeader: metadata.toHTTPHeader(),
      htmlMeta: metadata.toHTMLMeta()
    };

    // Create response with file data
    const response = {
      success: true,
      originalFile: {
        name: req.file.originalname,
        size: req.file.size,
        type: req.file.mimetype
      },
      metadata: outputs.metadata,
      formats: {
        xml: outputs.xml,
        httpHeader: outputs.httpHeader,
        htmlMeta: outputs.htmlMeta
      },
      downloads: {
        originalFile: `/api/download/original/${encodeURIComponent(req.file.originalname)}`,
        metadataXml: `/api/download/metadata/${encodeURIComponent(req.file.originalname)}.meta.xml`
      }
    };

    // Store files temporarily for download (in production, use proper file storage)
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const originalPath = path.join(tempDir, req.file.originalname);
    const metadataPath = path.join(tempDir, `${req.file.originalname}.meta.xml`);

    fs.writeFileSync(originalPath, req.file.buffer);
    fs.writeFileSync(metadataPath, outputs.xml);

    res.json(response);

  } catch (error) {
    console.error('Tagging error:', error);
    res.status(500).json({ error: 'Failed to tag content', details: error.message });
  }
});

// Validate content endpoint
app.post('/api/validate', upload.fields([
  { name: 'contentFile', maxCount: 1 },
  { name: 'metadataFile', maxCount: 1 }
]), async (req, res) => {
  try {
    const contentFile = req.files?.contentFile?.[0];
    const metadataFile = req.files?.metadataFile?.[0];

    if (!contentFile) {
      return res.status(400).json({ error: 'Content file is required' });
    }

    let metadata = null;

    // Try to parse metadata from uploaded metadata file or embedded in content
    if (metadataFile) {
      // Parse external metadata file
      if (metadataFile.originalname.endsWith('.xml')) {
        const xmlContent = metadataFile.buffer.toString('utf8');
        metadata = await ContentMetadata.parseXML(xmlContent);
      }
    } else {
      // Try to extract embedded metadata from content file
      const content = contentFile.buffer.toString('utf8');
      
      if (content.includes('X-Content-')) {
        metadata = parseHTMLMetadata(content);
      } else if (content.includes('X-Content-Metadata:')) {
        const headerMatch = content.match(/X-Content-Metadata:\s*(.+)/);
        if (headerMatch) {
          metadata = ContentMetadata.parseHTTPHeader(headerMatch[1]);
        }
      }
    }

    if (!metadata) {
      return res.status(400).json({ error: 'No valid metadata found' });
    }

    // Perform validation
    const result = {
      file: contentFile.originalname,
      timestamp: new Date().toISOString(),
      metadata: metadata.toObject(),
      checks: {
        metadata_valid: true,
        checksum_valid: false,
        schema_valid: false
      },
      overall: {
        valid: false,
        score: 0,
        issues: []
      }
    };

    // Validate schema
    const schemaValidation = metadata.validate();
    result.checks.schema_valid = schemaValidation.isValid;
    if (!schemaValidation.isValid) {
      result.overall.issues.push(`Schema validation failed: ${schemaValidation.error}`);
    }

    // Verify content integrity
    const integrityValid = metadata.verifyIntegrity(contentFile.buffer);
    result.checks.checksum_valid = integrityValid;
    if (!integrityValid) {
      result.overall.issues.push('Content checksum does not match - file may have been modified');
    }

    // Calculate overall validity
    const checkCount = Object.values(result.checks).filter(Boolean).length;
    result.overall.score = checkCount / Object.keys(result.checks).length;
    result.overall.valid = result.checks.metadata_valid && 
                           result.checks.checksum_valid && 
                           result.checks.schema_valid;

    res.json(result);

  } catch (error) {
    console.error('Validation error:', error);
    res.status(500).json({ error: 'Failed to validate content', details: error.message });
  }
});

// Download endpoints
app.get('/api/download/original/:filename', (req, res) => {
  try {
    const filename = decodeURIComponent(req.params.filename);
    const filePath = path.join(__dirname, 'temp', filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.download(filePath, filename);
  } catch (error) {
    res.status(500).json({ error: 'Failed to download file' });
  }
});

app.get('/api/download/metadata/:filename', (req, res) => {
  try {
    const filename = decodeURIComponent(req.params.filename);
    const filePath = path.join(__dirname, 'temp', filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Metadata file not found' });
    }

    res.setHeader('Content-Type', 'application/xml');
    res.download(filePath, filename);
  } catch (error) {
    res.status(500).json({ error: 'Failed to download metadata file' });
  }
});

// Utility function for parsing HTML metadata
function parseHTMLMetadata(content) {
  const metadata = {};
  
  const metaRegex = /<meta\s+name="X-Content-([^"]+)"\s+content="([^"]+)"/g;
  let match;
  
  while ((match = metaRegex.exec(content)) !== null) {
    const key = match[1].toLowerCase().replace('-', '_');
    metadata[key] = match[2];
  }
  
  return new ContentMetadata(metadata);
}

// Cleanup temp files periodically (basic cleanup - in production use proper file management)
setInterval(() => {
  const tempDir = path.join(__dirname, 'temp');
  if (fs.existsSync(tempDir)) {
    const files = fs.readdirSync(tempDir);
    const now = Date.now();
    
    files.forEach(file => {
      const filePath = path.join(tempDir, file);
      const stats = fs.statSync(filePath);
      
      // Delete files older than 1 hour
      if (now - stats.mtime.getTime() > 60 * 60 * 1000) {
        fs.unlinkSync(filePath);
      }
    });
  }
}, 30 * 60 * 1000); // Run every 30 minutes

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Express error:', error);
  res.status(500).json({ error: 'Internal server error', details: error.message });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 AI Content Tagging Tools Web Demo`);
  console.log(`📡 Server running on http://localhost:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🎯 Ready to tag and validate content!`);
  console.log('');
  console.log('Available endpoints:');
  console.log('  GET  / - Web interface');
  console.log('  POST /api/tag - Tag content with metadata');
  console.log('  POST /api/validate - Validate tagged content');
  console.log('  GET  /api/health - Service health check');
});