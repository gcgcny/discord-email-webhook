const express = require('express');
const AsyncRouter = require("express-async-router").AsyncRouter;
const axios = require('axios');
const yaml = require('yaml');
const fs = require('node:fs');

const config = yaml.parse(fs.readFileSync('config.yml', 'utf8'));

const app = express();
const router = AsyncRouter();

app.use(express.json());

router.post('/' + config['webhook_path'], async (req, res) => {
    // truncate footer from textbody
    const text = req.body['TextBody'].split('*Genesis Vision: *')[0].slice(0, -3);
    text.replace('*', '**'); // fix bold text formatting

    // split body into 4000 character chunks at newlines
    let max_iter = 10;
    let blocks = [];
    while (text.length > 4000 && max_iter > 0) {
        let idx = text.lastIndexOf('\n', 4000);
        blocks.push(text.slice(0, idx));
        text = text.slice(idx + 1);
        max_iter--;
    }
    blocks.push(text); // add the last chunk

    // construct webhook data
    const webhookData = {
        content: ''
    };

    webhookData.embeds = blocks.map((block) => { return { description: block } }); // add blocks as embeds
    webhookData.embeds[0].title = req.body.Subject; // add title to first embed

    // send webhook
    await axios.post(config['discord_webhook_url'], webhookData);
    res.send('OK'); // send 200 OK response
});

app.use('/', router); // use router for all requests

app.listen(config['port'], () => {
    console.log('Listening on port ' + config['port']);
});
