module.exports = {
  apps: [{
    name: "newapi-query",
    cwd: __dirname,
    script: "server.js",
    node_args: "--env-file=.env",
    env: { NODE_ENV: "production" },
  }],
};
