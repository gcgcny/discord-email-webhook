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
    console.log(req.body);

    // construct webhook data
    const webhookData = {
        content: '',
        embeds: [{
            title: req.body.Subject,
            fields: [
                {
                    name: 'Subject', 
                    value: req.body.Subject
                },
                {
                    name: 'Message',
                    value: req.body.TextBody
                }
            ]
        }]
    };

    console.log(webhookData);

    // send webhook
    await axios.post(config['discord_webhook_url'], webhookData);
    res.send('OK'); // send 200 OK response
});

app.use('/', router); // use router for all requests

app.listen(config['port'], () => {
    console.log('Listening on port ' + config['port']);
});
