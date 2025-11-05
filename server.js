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
    contentSecurityPolicy: false, // Disable for now to avoid issues
}));

app.use(compression());
app.use(morgan('combined'));

// CORS Configuration - FIXED
const allowedOrigins = [
    'https://sahilcodelab.github.io',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5500',
    'http://127.0.0.1:5500'
];

app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            console.log('Blocked by CORS:', origin);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Handle preflight requests
app.options('*', cors());

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
        service: 'Mailora API',
        allowedOrigins: allowedOrigins
    });
});

// Email Generation Endpoint
app.post('/api/generate-email', emailLimiter, async (req, res) => {
    try {
        console.log('Received email generation request:', {
            language: req.body.language,
            tone: req.body.tone,
            length: req.body.length,
            origin: req.headers.origin
        });

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
        if (!apiKey || apiKey === 'your_gemini_api_key_here') {
            return res.status(500).json({ 
                error: 'API configuration error - Please set GEMINI_API_KEY in environment variables' 
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
                signal: AbortSignal.timeout(30000)
            }
        );

        if (!response.ok) {
            const errorData = await response.json();
            console.error('Gemini API error:', errorData);
            throw new Error(`API request failed: ${response.status}`);
        }

        const data = await response.json();
        
        if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
            throw new Error('Invalid response format from AI service');
        }

        const emailContent = data.candidates[0].content.parts[0].text;

        console.log(`Email generated successfully - Language: ${language}, Tone: ${tone}, Length: ${length}`);

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

        // Fallback email generation
        const fallbackEmail = createFallbackEmail(
            req.body.recipientName || '[Recipient Name]',
            req.body.subject || req.body.purpose || 'Email',
            req.body.tone || 'Professional',
            req.body.personalNote || '',
            req.body.language || 'en',
            req.body.length || 'medium'
        );

        res.json({ 
            success: true,
            email: fallbackEmail,
            metadata: {
                language: req.body.language || 'en',
                tone: req.body.tone || 'Professional',
                length: req.body.length || 'medium',
                generatedAt: new Date().toISOString(),
                note: 'Generated using fallback method'
            }
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

function createFallbackEmail(recipientName, subject, tone, personalNote, language, length) {
    const templates = {
        'en': `Subject: ${subject}\n\nDear ${recipientName},\n\nI hope this email finds you well.\n\n${personalNote ? personalNote + '\n\n' : ''}Thank you for your time and consideration.\n\nBest regards,\n[Your Name]`,
        'es': `Asunto: ${subject}\n\nEstimado/a ${recipientName},\n\nEspero que este correo le encuentre bien.\n\n${personalNote ? personalNote + '\n\n' : ''}Gracias por su tiempo y consideración.\n\nAtentamente,\n[Su Nombre]`,
        'fr': `Objet: ${subject}\n\nCher ${recipientName},\n\nJ'espère que ce courriel vous trouvera en bonne santé.\n\n${personalNote ? personalNote + '\n\n' : ''}Merci pour votre temps et votre considération.\n\nCordialement,\n[Votre Nomme]`,
        'de': `Betreff: ${subject}\n\nSehr geehrte/r ${recipientName},\n\nIch hoffe, diese E-Mail erreicht Sie wohlbehalten.\n\n${personalNote ? personalNote + '\n\n' : ''}Vielen Dank für Ihre Zeit und Ihre Überlegungen.\n\nMit freundlichen Grüßen,\n[Ihr Name]`,
        'hi': `विषय: ${subject}\n\nप्रिय ${recipientName},\n\nमुझे आशा है कि यह ईमेल आपको अच्छी तरह मिलेगा।\n\n${personalNote ? personalNote + '\n\n' : ''}आपके समय और विचार के लिए धन्यवाद।\n\nसादर,\n[आपका नाम]`
    };

    return templates[language] || templates['en'];
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
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({ 
        error: 'Endpoint not found',
        path: req.originalUrl
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`
🚀 Mailora Backend Server Started!
📍 Port: ${PORT}
🌍 Environment: ${process.env.NODE_ENV || 'development'}
📧 Service: Multi-language Email Generation API
✅ CORS Enabled for: ${allowedOrigins.join(', ')}
    `);
});

export default app;
