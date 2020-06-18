module.exports = ({ env }) => ({
  github: {
    redirect_url: env("GITHUB_CALLBACK_HOST", ""),
    client_secret: env("GITHUB_CLIENT_SECRET", ""),
    client_id: env("GITHUB_CLIENT_ID", ""),
  },
  google: {
    redirect_url: env("GOOGLE_CALLBACK_HOST", ""),
  },
  facebook: {
    redirect_url: env("FACEBOOK_CALLBACK_HOST", ""),
  },
});
