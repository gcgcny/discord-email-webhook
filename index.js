const express = require('express');
const AsyncRouter = require("express-async-router").AsyncRouter;
const axios = require('axios');
const yaml = require('yaml');
const cheerio = require('cheerio');
const OpenAI = require('openai');
const crypto = require('crypto');

const fs = require('node:fs');
const { randomInt } = require('node:crypto');

// Parse command line arguments
const args = process.argv.slice(2);
const DEBUG_MODE = args.includes('--debug') || args.includes('-d');
const SAVE_BODY = args.includes('--save-body') || args.includes('-s');

const config = yaml.parse(fs.readFileSync('config.yml', 'utf8'));

// Initialize OpenAI client
const openai = new OpenAI({
    apiKey: config['openai_api_key'] // Add this to your config.yml
});

// Load Gen Z prompt
const genZPrompt = fs.readFileSync('gen_z_prompt.txt', 'utf8');

const app = express();
const router = AsyncRouter();

const MAX_ITER = 10;
const MSG_CHAR_LIMIT = 1800;

// Debug logging helper
function debugLog(...args) {
    if (DEBUG_MODE) {
        console.log('[DEBUG]', ...args);
    }
}

// Middleware to capture raw body for signature verification
app.use('/' + config['webhook_path'], express.raw({ type: 'application/json' }), (req, res, next) => {
    try {
        // Store raw body for signature verification
        req.rawBody = req.body;

        // Parse JSON manually
        req.body = JSON.parse(req.body.toString());

        // Verify webhook signature using raw body
        if (!isValidSignatureRaw(req)) {
            console.error('Invalid webhook signature');
            return res.status(403).send('Invalid webhook signature');
        }

        next();
    } catch (error) {
        console.error('Error parsing request body or verifying signature:', error);
        return res.status(400).send('Invalid request body or signature');
    }
});


// Helper function to remove email footer after Gmail signature prefix
function removeEmailFooter($) {
    // Look for Gmail signature prefix span
    const signaturePrefix = $('span.gmail_signature_prefix');

    if (signaturePrefix.length > 0) {
        // Remove this span and everything after it
        let current = signaturePrefix.first();

        // Remove all following siblings
        current.nextAll().remove();

        // Remove the signature prefix span itself
        current.remove();
    }
}

// Helper function to convert tables to Discord code blocks
function convertTables($) {
    $('table').each(function () {
        const table = $(this);
        let tableText = '\n```';

        // Collect all rows and calculate max column widths
        const rows = [];
        const maxWidths = [];

        table.find('tr').each(function () {
            const cells = [];
            $(this).find('td, th').each(function () {
                const cellText = $(this).text().trim().replace(/\s+/g, ' ');
                cells.push(cellText);
            });
            if (cells.length > 0) {
                rows.push(cells);

                // Update max widths
                cells.forEach((cell, index) => {
                    maxWidths[index] = Math.max(maxWidths[index] || 0, cell.length);
                });
            }
        });

        // Format rows with proper alignment
        rows.forEach((cells, rowIndex) => {
            const formattedCells = cells.map((cell, index) => {
                const width = Math.min(maxWidths[index] || 0, 25); // Cap width at 25 chars
                const truncatedCell = cell.length > 25 ? cell.substring(0, 22) + '...' : cell;
                return truncatedCell.padEnd(width);
            });
            tableText += formattedCells.join(' | ') + '\n';

            // Add separator line after header row (first row)
            if (rowIndex === 0 && rows.length > 1) {
                const separatorCells = maxWidths.map(width => {
                    const actualWidth = Math.min(width, 25);
                    return '-'.repeat(actualWidth);
                });
                tableText += separatorCells.join('-+-') + '\n';
            }
        });

        tableText += '```\n';
        table.replaceWith(tableText);
    });
}

// Helper function to convert links to plain text
function convertLinks($) {
    $('a').each(function () {
        const link = $(this);
        const href = link.attr('href');
        const text = link.text().trim();

        if (href && text) {
            link.replaceWith(`${text} (${href})`);
        } else if (text) {
            link.replaceWith(text);
        }
    });
}

// Helper function to convert bold and italic to Discord markdown
function convertMarkdown($) {
    $('b').each(function () {
        $(this).replaceWith(`**${$(this).text()}**`);
    });

    $('i').each(function () {
        $(this).replaceWith(`*${$(this).text()}*`);
    });
}

// Helper function to process paragraph and line breaks
function processLineBreaks($) {
    $('p').each(function () {
        $(this).replaceWith(`\n\n${$(this).html()}\n\n`);
    });

    $('br').replaceWith('\n');
}

// Helper function to strip unwanted HTML tags
function stripUnwantedTags($) {
    // Include list tags so we can process them later
    const allowedTags = ['p', 'br', 'b', 'i', 'a', 'table', 'tr', 'td', 'th', 'tbody', 'thead', 'ul', 'li', 'ol'];
    $('*').each(function () {
        if (!allowedTags.includes(this.tagName)) {
            $(this).replaceWith($(this).html());
        }
    });
}

// Helper to convert <ul>/<ol>/<li> into markdown bullet/numbered lists with double newlines around the block
function convertLists($) {
    // Ordered lists
    $('ol').each(function () {
        const ol = $(this);
        const items = [];
        let index = 1;
        ol.children('li').each(function () {
            const text = $(this).text().trim().replace(/\s+/g, ' ');
            if (text.length) {
                items.push(`${index}. ${text}`);
                index++;
            }
        });
        if (items.length) {
            ol.replaceWith(`\n\n${items.join('\n')}\n\n`);
        } else {
            ol.replaceWith('');
        }
    });

    // Unordered lists
    $('ul').each(function () {
        const ul = $(this);
        const items = [];
        ul.children('li').each(function () {
            const text = $(this).text().trim().replace(/\s+/g, ' ');
            if (text.length) {
                items.push(`- ${text}`);
            }
        });
        if (items.length) {
            ul.replaceWith(`\n\n${items.join('\n')}\n\n`);
        } else {
            ul.replaceWith('');
        }
    });
}

// Ensure spaces between adjacent HTML elements so text does not run together
function ensureElementSpacing($) {
    let htmlString = $.html();
    // Add a space between closing and next opening tag when none exists (avoid introducing multiple spaces)
    htmlString = htmlString.replace(/>(?=<)/g, '> ');
    return cheerio.load(htmlString);
}

// Helper function to clean up text whitespace
function cleanupText(text) {
    // Split text into code blocks and regular text
    const parts = text.split(/(```[\s\S]*?```)/);

    return parts.map((part, index) => {
        if (part.startsWith('```') && part.endsWith('```')) {
            // This is a code block - preserve formatting
            return "\n\n" + part + "\n\n";
        } else {
            // This is regular text - clean up whitespace
            return part
                .replace(/\n\s*\n\s*\n/g, '\n\n') // Replace multiple newlines with double newlines
                .replace(/^\s+|\s+$/g, '') // Trim start and end
                .replace(/[ \t]+/g, ' '); // Replace multiple spaces/tabs with single space
        }
    }).join('');
}

// Helper function to split text into Discord-sized blocks
function splitText(text, maxLength) {
    const blocks = [];
    let currentBlock = '';

    // Try splitting by paragraphs first
    const paragraphs = text.split(/\n\n+/);

    for (const paragraph of paragraphs) {
        if (currentBlock.length + paragraph.length + 2 <= maxLength) {
            currentBlock += (currentBlock ? '\n\n' : '') + paragraph;
        } else {
            if (currentBlock) blocks.push(currentBlock);

            if (paragraph.length <= maxLength) {
                currentBlock = paragraph;
            } else {
                // Split long paragraphs by lines, then words if needed
                const lines = paragraph.split('\n');
                let tempBlock = '';

                for (const line of lines) {
                    if (tempBlock.length + line.length + 1 <= maxLength) {
                        tempBlock += (tempBlock ? '\n' : '') + line;
                    } else {
                        if (tempBlock) blocks.push(tempBlock);

                        if (line.length <= maxLength) {
                            tempBlock = line;
                        } else {
                            // Split by words as last resort
                            const words = line.split(/\s+/);
                            let wordBlock = '';

                            for (const word of words) {
                                if (wordBlock.length + word.length + 1 <= maxLength) {
                                    wordBlock += (wordBlock ? ' ' : '') + word;
                                } else {
                                    if (wordBlock) blocks.push(wordBlock);
                                    wordBlock = word.length <= maxLength ? word : word.substring(0, maxLength);
                                }
                            }
                            tempBlock = wordBlock;
                        }
                    }
                }
                currentBlock = tempBlock;
            }
        }
    }

    if (currentBlock) blocks.push(currentBlock);
    return blocks.length > 0 ? blocks : [''];
}

// Helper function to translate email content to Gen Z style using OpenAI
async function translateToGenZ(emailContent) {
    try {
        // Insert email content into the prompt template
        const fullPrompt = genZPrompt.replace('{{ email_body }}', emailContent);

        debugLog('Translating content to Gen Z style...');
        const response = await openai.chat.completions.create({
            model: "gpt-4.1-mini",
            messages: [
                {
                    role: "system",
                    content: "You are a Gen Z youth translator that converts formal email content into Gen Z slang  style, lingz, and memes."
                },
                {
                    role: "user",
                    content: fullPrompt
                }
            ],
            max_tokens: 5000,
            temperature: 0.5
        });

        debugLog('Gen Z translation completed');
        return response.choices[0].message.content;
    } catch (error) {
        console.error('Error translating to Gen Z:', error);
        return emailContent; // Return original content if translation fails
    }
}

// Helper function to verify DKIM signature and envelope from
function verifyDKIM(dkimData, allowedFromEmails) {
    try {
        // Check if DKIM data exists
        if (!dkimData || !dkimData.envelopeFrom || !dkimData.results) {
            debugLog('DKIM verification failed: Missing DKIM data');
            return { valid: false, reason: 'Missing DKIM data' };
        }

        // Verify envelope from is in allowed list
        const envelopeFrom = dkimData.envelopeFrom;
        debugLog('Envelope from:', envelopeFrom);
        debugLog('Allowed emails:', allowedFromEmails);

        if (!allowedFromEmails.includes(envelopeFrom)) {
            debugLog('DKIM verification failed: Envelope from not in allowed list');
            return { valid: false, reason: `Envelope from ${envelopeFrom} not in allowed list` };
        }

        // Verify DKIM signature status
        const results = dkimData.results;
        if (!Array.isArray(results) || results.length === 0) {
            debugLog('DKIM verification failed: No DKIM results');
            return { valid: false, reason: 'No DKIM results found' };
        }

        // Check if at least one DKIM signature passed
        const passedSignatures = results.filter(result =>
            result.status && result.status.result === 'pass'
        );

        if (passedSignatures.length === 0) {
            debugLog('DKIM verification failed: No valid signatures');
            return { valid: false, reason: 'No valid DKIM signatures found' };
        }

        debugLog('DKIM verification passed:', passedSignatures.length, 'valid signature(s)');
        return { valid: true, signatures: passedSignatures };

    } catch (error) {
        debugLog('DKIM verification error:', error);
        return { valid: false, reason: `Verification error: ${error.message}` };
    }
}

function isValidSignatureRaw(req) {
    if (!config['fe_webhook_signature_key']) {
        return true; // Skip signature verification if key is not set
    }

    debugLog('Request headers:', req.headers);
    const signature = req.headers['x-webhook-signature'];
    // Convert hex-encoded key to Buffer
    const keyBuffer = Buffer.from(config['fe_webhook_signature_key'], 'ascii');
    const expectedSignature = crypto.createHmac('sha256', keyBuffer)
        .update(req.rawBody) // Use raw body instead of JSON.stringify
        .digest('hex');
    debugLog('Computed signature:', expectedSignature);
    return signature === expectedSignature;
}

router.post('/' + config['webhook_path'], async (req, res) => {
    try {
        // Save the request body to text file if in save mode
        if (SAVE_BODY) {
            fs.writeFileSync('request_body.json', JSON.stringify(req.body, null, 2));
            debugLog('Request body saved to request_body.json');

            fs.writeFileSync('request_headers.json', JSON.stringify(req.headers, null, 2));
            debugLog('Request headers saved to request_headers.json');
        }

        // Webhook signature is already verified in middleware before JSON parsing

        // Verify DKIM signature before processing
        const dkimVerification = verifyDKIM(req.body.dkim, config.allowed_from_emails);
        if (!dkimVerification.valid) {
            console.error('DKIM verification failed:', dkimVerification.reason);
            return res.status(403).send(`DKIM verification failed: ${dkimVerification.reason}`);
        }

        debugLog('DKIM verification successful');

        let htmlContent = req.body['html'];
        debugLog('Received email content:', htmlContent);

        // Parse HTML with cheerio
        let $ = cheerio.load(htmlContent);

        // Step 1: Remove email footer after Gmail signature prefix
        removeEmailFooter($);

        // Step 2: Strip unwanted tags (keep only allowed ones)
        stripUnwantedTags($);

        // Step 3: Convert tables to Discord code blocks
        convertTables($);

        // Step 4: Convert links to plain text format
        convertLinks($);

        // Step 5: Convert bold/italic to Discord markdown
        convertMarkdown($);

        // Step 5.5: Convert lists to markdown bullets / numbering with double newlines
        convertLists($);

        // Step 6: Process paragraph and line breaks
        processLineBreaks($);

        // Step 6.5: Ensure spaces between elements before extracting text
        $ = ensureElementSpacing($);

        // Step 7: Extract and clean up text (lists already have surrounding double newlines)
        let processedText = $.text();
        processedText = cleanupText(processedText);

        // Step 8: Add subject to processed text
        if (req.body.subject) {
            processedText = `**${req.body.subject}**\n\n${processedText}`;
        }

        // Step 9: Split original content into Discord-sized blocks
        let blocks = splitText(processedText, MSG_CHAR_LIMIT);

        // Step 10: Send original blocks to Discord
        debugLog('Sending original version...');
        for (const block of blocks) {
            if (block.trim().length > 0) {
                if (!DEBUG_MODE) {

                    await axios.post(config['discord_webhook_url'], {
                        "content": block
                    });
                }
                debugLog('Sent original block to Discord:', block);
            }
        }

        const DISCLAIMERS = [
            "lowkey, chatty ain't always 100% accurate 👀. peep the receipts (dates, times, places) in #emails just in case.",
            "ngl, chatty can slip up sometimes. fact check deets like dates, times, and locations in the boomer chat #emails",
            "chatty's got the vibes 😎, but always double-check the deets in #emails just to be sure 💪.",
            "not gonna lie, chatty might fumble the bag sometimes 💀. fact check the big deets in #emails like dates n locations.",
            "tbh, chatty be 95% valid but still slip here n there 😬. cross-check the info (dates, times, places) in #emails.",
            "chatty's solid but can still tweak a bit 🙊. verify dates, times, n spots over in the boomer chat: #emails",
            "chatty usually slaps, but sometimes it sus 😮‍💨 peep the receipts (dates/times/locs) in #emails"
        ];

        // Step 11: Translate to Gen Z style and send to separate webhook (if enabled)
        if (config['enable_genz_translation'] && config['discord_webhook_url_genz']) {
            debugLog('Translating to Gen Z style...');
            const genZTranslation = await translateToGenZ(processedText);
            const genZcontent = genZTranslation + `\n\n---\n` + DISCLAIMERS[randomInt(DISCLAIMERS.length)];

            // Add Gen Z prefix and split into blocks
            const genZBlocks = splitText(genZcontent, MSG_CHAR_LIMIT);

            debugLog('Sending Gen Z version...');
            for (const block of genZBlocks) {
                if (block.trim().length > 0) {
                    if (!DEBUG_MODE) {
                        await axios.post(config['discord_webhook_url_genz'], {
                            "content": block
                        });
                    }
                    debugLog('Sent Gen Z block to Discord:', block);
                }
            }
        }

        res.send('OK');
    } catch (error) {
        console.error('Error processing email:', error);
        res.status(500).send('Error processing email');
    }
});

app.use('/', router); // use router for all requests

app.listen(config['port'], () => {
    console.log('Listening on port ' + config['port']);
    if (DEBUG_MODE) {
        console.log('[DEBUG MODE ENABLED] - Console logging enabled, Discord webhooks disabled');
        console.log('To disable debug mode, run without --debug or -d flags');
    }
});
