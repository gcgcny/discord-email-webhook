const express = require('express');
const AsyncRouter = require("express-async-router").AsyncRouter;
const axios = require('axios');
const yaml = require('yaml');
const fs = require('node:fs');

const config = yaml.parse(fs.readFileSync('config.yml', 'utf8'));

const app = express();
const router = AsyncRouter();

const MAX_ITER = 10;
const MSG_CHAR_LIMIT = 1800;

app.use(express.json());

router.post('/' + config['webhook_path'], async (req, res) => {
    // truncate footer from textbody
    let text = req.body['TextBody'].split('*Genesis Vision: *')[0].slice(0, -5);
    text = text.replace('*', '**'); // fix bold text formatting

    // split body into chunks at newlines, based on char limit
    let curr_iter = 10;
    let blocks = [];
    while (text.length > MSG_CHAR_LIMIT && curr_iter > 0) {
        let idx = text.lastIndexOf('\n', MSG_CHAR_LIMIT);
        blocks.push(text.slice(0, idx));
        text = text.slice(idx + 1);
        curr_iter--;
    }
    blocks.push(text); // add the last chunk

    blocks[0] = '**' + req.body.Subject + '**\n' + blocks[0];

    for (const cb of blocks) {
        await axios.post(config['discord_webhook'], {
            "content": cb
        });
    }
    res.send('OK'); // send 200 OK response
});

app.use('/', router); // use router for all requests

app.listen(config['port'], () => {
    console.log('Listening on port ' + config['port']);
});
