"use strict";

/**
 * Auth.js controller
 *
 * @description: A set of functions called "actions" for managing `Auth`.
 */

/* eslint-disable no-useless-escape */
const crypto = require("crypto");
const _ = require("lodash");
const grant = require("grant-koa");
const { sanitizeEntity } = require("strapi-utils");

const emailRegExp = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
const formatError = (error) => [
  { messages: [{ id: error.id, message: error.message, field: error.field }] },
];

module.exports = {
  async connect(ctx, next) {
    const grantConfig = await strapi
      .store({
        environment: "",
        type: "plugin",
        name: "users-permissions",
        key: "grant",
      })
      .get();

    const [requestPath] = ctx.request.url.split("?");
    const provider = requestPath.split("/")[2];

    if (!_.get(grantConfig[provider], "enabled")) {
      return ctx.badRequest(null, "This provider is disabled.");
    }
    // Ability to pass OAuth callback dynamically
    const url_callback =
      _.get(ctx, "query.callback") || grantConfig[provider].callback;
    grantConfig[provider].callback = url_callback;
    const url_connect =
      strapi.config.provider[provider].redirect_url ||
      `${strapi.config.server.url}/connect/${provider}/callback`;
    grantConfig[provider].redirect_uri = url_connect;

    return grant(grantConfig)(ctx, next);
  },

  async getEnabledProviders(ctx, next) {
    const grantConfig = await strapi
      .store({
        environment: "",
        type: "plugin",
        name: "users-permissions",
        key: "grant",
      })
      .get();

    // if (!_.get(grantConfig[provider], "enabled")) {
    //   return ctx.badRequest(null, "This provider is disabled.");
    // }

    return _.mapValues(grantConfig, "enabled");
  },
};
