import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Security Middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.tailwindcss.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            scriptSrc: ["'self'", "https://cdn.tailwindcss.com"],
            imgSrc: ["'self'", "data:", "https:"],
        },
    },
}));

app.use(compression());
app.use(morgan('combined'));

// CORS Configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'];
app.use(cors({
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true
}));

app.use(express.json({ limit: '10mb' }));

// Rate Limiting
const emailLimiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
    message: {
        error: 'Too many email generation requests from this IP, please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Health Check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        service: 'Mailora API'
    });
});

// Email Generation Endpoint
app.post('/api/generate-email', emailLimiter, async (req, res) => {
    try {
        const { recipientName, subject, tone, personalNote, length, language, purpose } = req.body;

        // Input validation
        if (!subject && !purpose) {
            return res.status(400).json({ 
                error: 'Email subject or purpose is required' 
            });
        }

        if (!language || !tone || !length) {
            return res.status(400).json({ 
                error: 'Language, tone, and length are required fields' 
            });
        }

        const finalSubject = subject || purpose;
        const prompt = createEmailPrompt(recipientName, finalSubject, tone, personalNote, length, language);

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ 
                error: 'API configuration error' 
            });
        }

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [{
                            text: prompt
                        }]
                    }],
                    generationConfig: {
                        temperature: 0.7,
                        topK: 40,
                        topP: 0.95,
                        maxOutputTokens: getMaxTokens(length),
                    }
                }),
                signal: AbortSignal.timeout(30000) // 30 second timeout
            }
        );

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`API request failed: ${response.status} - ${JSON.stringify(errorData)}`);
        }

        const data = await response.json();
        
        if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
            throw new Error('Invalid response format from AI service');
        }

        const emailContent = data.candidates[0].content.parts[0].text;

        // Log successful generation (without sensitive data)
        console.log(`Email generated - Language: ${language}, Tone: ${tone}, Length: ${length}`);

        res.json({ 
            success: true,
            email: emailContent,
            metadata: {
                language,
                tone,
                length,
                generatedAt: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('Email generation error:', error);
        
        if (error.name === 'AbortError') {
            return res.status(408).json({ 
                error: 'Request timeout. Please try again.' 
            });
        }

        res.status(500).json({ 
            error: 'Failed to generate email. Please try again later.',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Utility functions
function createEmailPrompt(recipientName, subject, tone, personalNote, length, language) {
    const lengthMap = {
        'short': '3-4 sentences',
        'medium': '5-7 sentences', 
        'long': '8-10 sentences'
    };

    const languageInstructions = {
        'en': 'Write in English',
        'es': 'Escribe en Español',
        'fr': 'Écris en Français',
        'de': 'Schreibe auf Deutsch',
        'hi': 'हिंदी में लिखें',
        'ja': '日本語で書いてください',
        'zh': '用中文写',
        'ar': 'اكتب بالعربية',
        'pt': 'Escreva em Português',
        'ru': 'Пишите на русском'
    };

    return `
Generate a professional email with the following specifications:

LANGUAGE: ${languageInstructions[language] || 'English'}
RECIPIENT: ${recipientName || '[Recipient Name]'}
SUBJECT: ${subject}
TONE: ${tone}
LENGTH: ${lengthMap[length]}
${personalNote ? `PERSONAL NOTE TO INCLUDE: ${personalNote}` : ''}

IMPORTANT INSTRUCTIONS:
- Start with "Subject: [the provided subject]"
- Use appropriate greeting and closing for the specified language
- Maintain ${tone.toLowerCase()} tone throughout
- Sound natural and human-like
- Be professional and appropriate for business communication
- Include the personal note if provided
- Format with proper line breaks and paragraphs
- Use culturally appropriate expressions for the target language
- Ensure grammatical correctness in the specified language

Generate only the email content without any additional explanations or markdown formatting.
`.trim();
}

function getMaxTokens(length) {
    const tokenMap = {
        'short': 800,
        'medium': 1200,
        'long': 1800
    };
    return tokenMap[length] || 1200;
}

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({ 
        error: 'Internal server error' 
    });
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({ 
        error: 'Endpoint not found' 
    });
});

app.listen(PORT, () => {
    console.log(`
🚀 Mailora Backend Server Started!
📍 Port: ${PORT}
🌍 Environment: ${process.env.NODE_ENV || 'development'}
📧 Service: Multi-language Email Generation API
    `);
});

export default app;
