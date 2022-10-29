module.exports = {
  apps : [{
    name: "discord-email-webhook",
    script: "index.js",
    cwd: __dirname,
    env: {
      NODE_ENV: "production",
    }
  }]
};
