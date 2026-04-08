import assert from "node:assert/strict";
import test from "node:test";

import { JSDOM } from "jsdom";
import React, { act, useEffect } from "react";
import { createRoot } from "react-dom/client";

import { useInboxAlert } from "./use-inbox-alert.js";

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

class AudioStub {
  static lastInstance: AudioStub | null = null;
  static playCallCount = 0;

  currentTime = 0;
  preload = "";

  constructor(_src: string) {
    AudioStub.lastInstance = this;
  }

  pause(): void {}

  play(): Promise<void> {
    AudioStub.playCallCount += 1;
    return Promise.resolve();
  }
}

function installDom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost/",
  });
  const { window } = dom;
  const originalGlobals = new Map<string, PropertyDescriptor | undefined>();
  const assignGlobal = (name: string, value: unknown): void => {
    originalGlobals.set(
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    );
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value,
      writable: true,
    });
  };

  assignGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  assignGlobal("window", window);
  assignGlobal("document", window.document);
  assignGlobal("Document", window.Document);
  assignGlobal("navigator", window.navigator);
  assignGlobal("Element", window.Element);
  assignGlobal("HTMLElement", window.HTMLElement);
  assignGlobal("MutationObserver", window.MutationObserver);
  assignGlobal("Node", window.Node);
  assignGlobal("ShadowRoot", window.ShadowRoot);
  assignGlobal("SVGElement", window.SVGElement);
  assignGlobal("Audio", AudioStub);

  const mountNode = window.document.createElement("div");
  window.document.body.appendChild(mountNode);

  return {
    cleanup() {
      mountNode.remove();
      for (const [name, descriptor] of originalGlobals.entries()) {
        if (descriptor) {
          Object.defineProperty(globalThis, name, descriptor);
        } else {
          Reflect.deleteProperty(globalThis, name);
        }
      }
      dom.window.close();
    },
    mountNode,
  };
}

function Probe({ onReady }: { onReady: (playInboxAlert: () => void) => void }) {
  const { playInboxAlert } = useInboxAlert();

  useEffect(() => {
    onReady(playInboxAlert);
  }, [onReady, playInboxAlert]);

  return null;
}

test("useInboxAlert plays the notification sound", async () => {
  AudioStub.lastInstance = null;
  AudioStub.playCallCount = 0;
  const dom = installDom();
  const root = createRoot(dom.mountNode);
  let playInboxAlert: (() => void) | null = null;

  try {
    await act(async () => {
      root.render(
        <Probe
          onReady={(play) => {
            playInboxAlert = play;
          }}
        />,
      );
      await Promise.resolve();
    });

    const audio = AudioStub.lastInstance;
    if (!audio) {
      throw new Error("Expected the inbox alert audio to be created");
    }

    const inboxAlertAudio = audio as AudioStub;
    inboxAlertAudio.currentTime = 12;
    await act(async () => {
      playInboxAlert?.();
      await Promise.resolve();
    });

    assert.equal(inboxAlertAudio.currentTime, 0);
    assert.equal(AudioStub.playCallCount, 1);
  } finally {
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    dom.cleanup();
  }
});
