import request from "supertest";
import { createApp } from "../../src/app";
import type { Express } from "express";

let cachedApp: Express | null = null;

export const getApp = (): Express => {
  if (!cachedApp) {
    cachedApp = createApp();
  }
  return cachedApp;
};

export const getSupertest = () => request(getApp());
