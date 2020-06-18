"use strict";

/**
 * Module dependencies.
 */

// Public node modules.
const _ = require("lodash");
const request = require("request");

// Purest strategies.
const purest = require("purest")({ request });
const purestConfig = require("@purest/providers");

/**
 * Connect thanks to a third-party provider.
 *
 *
 * @param {String}    provider
 * @param {String}    access_token
 *
 * @return  {*}
 */

exports.connect = (provider, query) => {
  const access_token = query.access_token || query.code || query.oauth_token;

  return new Promise((resolve, reject) => {
    if (!access_token) {
      return reject([null, { message: "No access_token." }]);
    }

    // Get the profile.
    getProfile(provider, query, async (err, profile) => {
      if (err) {
        console.error("getProfile done, err", err);
        return reject([null, err]);
      }

      console.log("getProfile done, profile", profile);
      // We need at least the mail.
      if (!profile.email) {
        return reject([null, { message: "Email was not available." }]);
      }

      try {
        const users = await strapi.query("user", "users-permissions").find({
          email: profile.email,
        });

        const advanced = await strapi
          .store({
            environment: "",
            type: "plugin",
            name: "users-permissions",
            key: "advanced",
          })
          .get();

        if (
          _.isEmpty(_.find(users, { provider })) &&
          !advanced.allow_register
        ) {
          return resolve([
            null,
            [{ messages: [{ id: "Auth.advanced.allow_register" }] }],
            "Register action is actualy not available.",
          ]);
        }

        const user = _.find(users, { provider });

        if (!_.isEmpty(user)) {
          return resolve([user, null]);
        }

        if (
          !_.isEmpty(_.find(users, (user) => user.provider !== provider)) &&
          advanced.unique_email
        ) {
          return resolve([
            null,
            [{ messages: [{ id: "Auth.form.error.email.taken" }] }],
            "Email is already taken.",
          ]);
        }

        // Retrieve default role.
        const defaultRole = await strapi
          .query("role", "users-permissions")
          .findOne({ type: advanced.default_role }, []);

        // Create the new user.
        const params = _.assign(profile, {
          provider: provider,
          role: defaultRole.id,
          confirmed: true,
        });

        const createdUser = await strapi
          .query("user", "users-permissions")
          .create(params);

        return resolve([createdUser, null]);
      } catch (err) {
        reject([null, err]);
      }
    });
  });
};

/**
 * Helper to get profiles
 *
 * @param {String}   provider
 * @param {Function} callback
 */

const getProfile = async (provider, query, callback) => {
  const access_token = query.access_token || query.code || query.oauth_token;
  console.log("getProfile, access_token", access_token);

  const grant = await strapi
    .store({
      environment: "",
      type: "plugin",
      name: "users-permissions",
      key: "grant",
    })
    .get();

  const client_id =
    strapi.config.provider[provider].client_id || grant[provider].key || "";
  const client_secret =
    strapi.config.provider[provider].client_secret ||
    grant[provider].secret ||
    "";
  let redirect_uri =
    strapi.config.provider[provider].redirect_url ||
    grant[provider].callback ||
    "";

  console.log("getProfile provider", provider);
  console.log(`getProfile, grant[${provider}]`, grant[provider]);
  console.log(
    `getProfile, strapi.config.provider[${provider}]`,
    strapi.config.provider[provider]
  );
  console.log("getProfile, client_id", client_id);
  console.log("getProfile, client_secret", client_secret);
  console.log("getProfile, redirect_uri", redirect_uri);
  console.log("getProfile query", query);

  switch (provider) {
    case "discord": {
      const discord = purest({
        provider: "discord",
        config: {
          discord: {
            "https://discordapp.com/api/": {
              __domain: {
                auth: {
                  auth: { bearer: "[0]" },
                },
              },
              "{endpoint}": {
                __path: {
                  alias: "__default",
                },
              },
            },
          },
        },
      });
      discord
        .query()
        .get("users/@me")
        .auth(access_token)
        .request((err, res, body) => {
          if (err) {
            callback(err);
          } else {
            // Combine username and discriminator because discord username is not unique
            var username = `${body.username}#${body.discriminator}`;
            callback(null, {
              username: username,
              email: body.email,
            });
          }
        });
      break;
    }
    case "facebook": {
      const facebook = purest({
        provider: "facebook",
        config: {
          facebook: {
            "https://graph.facebook.com": {
              __domain: {
                auth: {
                  auth: { bearer: "[0]" },
                },
              },
              "{endpoint}": {
                __path: {
                  alias: "__default",
                },
              },
              "[version]/oauth/access_{endpoint}": {
                __path: {
                  alias: "oauth",
                  version: "v7.0",
                },
              },
            },
          },
        },
      });

      if (query.code) {
        facebook
          .query("oauth")
          .get("token")
          .qs({ client_id, client_secret, code: query.code, redirect_uri })
          .request((err, res, { access_token }) => {
            if (err) {
              return callback(err);
            }
            getProfileFromFacebook(facebook, access_token, callback);
          });
      } else {
        getProfileFromFacebook(facebook, access_token, callback);
      }
      break;
    }
    case "google": {
      const google = purest({
        provider: "google",
        config: {
          google: {
            "https://www.googleapis.com": {
              __domain: {
                auth: {
                  auth: { bearer: "[0]" },
                },
              },
              "{endpoint}": {
                __path: {
                  alias: "__default",
                },
              },
              "auth/userinfo.email": {
                __path: {
                  alias: "email",
                },
              },
            },
            "https://accounts.google.com": {
              __domain: {
                auth: {
                  auth: { user: "[0]", pass: "[1]" },
                },
              },
              "o/oauth2/[version]/{endpoint}": {
                __path: {
                  alias: "oauth",
                  version: "v2",
                },
              },
            },
            "https://oauth2.googleapis.com": {
              __domain: {},
              token: {
                __path: {
                  alias: "code",
                },
              },
            },
          },
        },
      });

      if (query.code) {
        google
          .query("code")
          .post()
          .json({
            code: query.code,
            client_id,
            client_secret,
            redirect_uri,
            grant_type: "authorization_code",
          })
          .request((err, res, body) => {
            if (err) {
              console.error("Google error", err);
              callback(err);
            } else {
              console.log("Google repsonse", body);
              getProfileFromGoogle(body.id_token, callback);
            }
          });
      } else {
        getProfileFromGoogle(access_token, callback);
      }

      break;
    }
    case "github": {
      const github = purest({
        provider: "github",
        config: {
          github: {
            "https://api.github.com": {
              __domain: {
                auth: {
                  auth: { bearer: "[0]" },
                },
              },
              "{endpoint}": {
                __path: {
                  alias: "__default",
                },
              },
            },
            "https://github.com": {
              __domain: {},
              "login/oauth/access_token": {
                __path: {
                  alias: "code",
                },
              },
            },
          },
        },
        defaults: {
          headers: {
            "user-agent": "strapi",
          },
        },
      });
      if (query.code) {
        github
          .query("code")
          .post()
          .json({ code: query.code, client_id, client_secret })
          .request((err, res, { access_token }) => {
            if (err) {
              return callback(err);
            }
            getProfileFromGithub(github, access_token, callback);
          });
      } else {
        getProfileFromGithub(github, access_token, callback);
      }
      break;
    }
    case "microsoft": {
      const microsoft = purest({
        provider: "microsoft",
        config: purestConfig,
      });

      microsoft
        .query()
        .get("me")
        .auth(access_token)
        .request((err, res, body) => {
          if (err) {
            callback(err);
          } else {
            callback(null, {
              username: body.userPrincipalName,
              email: body.userPrincipalName,
            });
          }
        });
      break;
    }
    case "twitter": {
      const twitter = purest({
        provider: "twitter",
        config: purestConfig,
        key: grant.twitter.key,
        secret: grant.twitter.secret,
      });

      twitter
        .query()
        .get("account/verify_credentials")
        .auth(access_token, query.access_secret)
        .qs({ screen_name: query["raw[screen_name]"], include_email: "true" })
        .request((err, res, body) => {
          if (err) {
            callback(err);
          } else {
            callback(null, {
              username: body.screen_name,
              email: body.email,
            });
          }
        });
      break;
    }
    case "instagram": {
      const instagram = purest({
        config: purestConfig,
        provider: "instagram",
        key: grant.instagram.key,
        secret: grant.instagram.secret,
      });

      instagram
        .query()
        .get("users/self")
        .qs({ access_token })
        .request((err, res, body) => {
          if (err) {
            callback(err);
          } else {
            callback(null, {
              username: body.data.username,
              email: `${body.data.username}@strapi.io`, // dummy email as Instagram does not provide user email
            });
          }
        });
      break;
    }
    case "vk": {
      const vk = purest({
        provider: "vk",
        config: purestConfig,
      });

      vk.query()
        .get("users.get")
        .qs({ access_token, id: query.raw.user_id, v: "5.013" })
        .request((err, res, body) => {
          if (err) {
            callback(err);
          } else {
            callback(null, {
              username: `${body.response[0].last_name} ${body.response[0].first_name}`,
              email: query.raw.email,
            });
          }
        });
      break;
    }
    case "twitch": {
      const twitch = purest({
        provider: "twitch",
        config: {
          twitch: {
            "https://api.twitch.tv": {
              __domain: {
                auth: {
                  headers: {
                    Authorization: "Bearer [0]",
                    "Client-ID": "[1]",
                  },
                },
              },
              "helix/{endpoint}": {
                __path: {
                  alias: "__default",
                },
              },
              "oauth2/{endpoint}": {
                __path: {
                  alias: "oauth",
                },
              },
            },
          },
        },
      });

      twitch
        .get("users")
        .auth(access_token, grant.twitch.key)
        .request((err, res, body) => {
          if (err) {
            callback(err);
          } else {
            callback(null, {
              username: body.data[0].login,
              email: body.data[0].email,
            });
          }
        });
      break;
    }
    default:
      callback({
        message: "Unknown provider.",
      });
      break;
  }
};

const getProfileFromGithub = (github, access_token, callback) => {
  github
    .query()
    .get("user")
    .auth(access_token)
    .request((err, res, userbody) => {
      if (err) {
        return callback(err);
      }

      // This is the public email on the github profile
      if (userbody.email) {
        return callback(null, {
          username: userbody.login,
          email: userbody.email,
        });
      }

      // Get the email with Github's user/emails API
      github
        .query()
        .get("user/emails")
        .auth(access_token)
        .request((err, res, emailsbody) => {
          if (err) {
            return callback(err);
          }

          return callback(null, {
            username: userbody.login,
            email: Array.isArray(emailsbody)
              ? emailsbody.find((email) => email.primary === true).email
              : null,
          });
        });
    });
};

const getProfileFromFacebook = (facebook, access_token, callback) => {
  facebook
    .query()
    .get("me?fields=name,email")
    .auth(access_token)
    .request((err, res, body) => {
      if (err) {
        callback(err);
      } else {
        callback(null, {
          username: body.name,
          email: body.email,
        });
      }
    });
};

const getProfileFromGoogle = (access_token, callback) => {
  const jwt = require("jsonwebtoken");
  var decoded = jwt.decode(access_token);
  callback(null, { ...decoded, username: decoded.email });
};
