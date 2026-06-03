/**
 * Tests for the Dolt supervisor generator (adj-182.1.3, T003a/b).
 *
 * `renderLaunchdPlist` and `renderSystemdUnit` are PURE functions that emit
 * supervisor definitions for a single per-project Dolt SQL server pinned to a
 * stable port. The supervisor restarts the server on crash (KeepAlive) and at
 * load (RunAtLoad / WantedBy), so `bd` never fails against a dead ephemeral
 * port after sleep/crash/churn.
 *
 * These functions perform NO I/O — they only render strings. Installation /
 * loading is a separate orchestration step (adj-182.1.4).
 */
import { describe, it, expect } from "vitest";

import {
  renderLaunchdPlist,
  renderSystemdUnit,
  type SupervisorSpec,
} from "../../../cli/lib/dolt-supervisor.js";

const SPEC: SupervisorSpec = {
  label: "com.adjutant.dolt.a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  doltBin: "/usr/local/bin/dolt",
  configPath: "/Users/me/proj/.beads/dolt/config.yaml",
  workingDir: "/Users/me/proj/.beads/dolt",
  logPath: "/Users/me/proj/.beads/dolt-server.log",
};

describe("renderLaunchdPlist", () => {
  it("should emit a well-formed plist document with the plist DOCTYPE and root dict", () => {
    const plist = renderLaunchdPlist(SPEC);
    expect(plist).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(plist).toContain(
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    );
    expect(plist).toContain('<plist version="1.0">');
    expect(plist.trimEnd().endsWith("</plist>")).toBe(true);
    // root dict + KeepAlive dict at minimum
    expect(plist.match(/<dict>/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("should set the Label key to the supervisor label", () => {
    const plist = renderLaunchdPlist(SPEC);
    expect(plist).toContain("<key>Label</key>");
    expect(plist).toContain(`<string>${SPEC.label}</string>`);
  });

  it("should emit ProgramArguments running `dolt sql-server --config <configPath>`", () => {
    const plist = renderLaunchdPlist(SPEC);
    expect(plist).toContain("<key>ProgramArguments</key>");
    const argsBlock = plist.slice(
      plist.indexOf("<key>ProgramArguments</key>"),
      plist.indexOf("</array>", plist.indexOf("<key>ProgramArguments</key>")),
    );
    expect(argsBlock).toContain(`<string>${SPEC.doltBin}</string>`);
    expect(argsBlock).toContain("<string>sql-server</string>");
    expect(argsBlock).toContain("<string>--config</string>");
    expect(argsBlock).toContain(`<string>${SPEC.configPath}</string>`);
    // order: doltBin -> sql-server -> --config -> configPath
    const iBin = argsBlock.indexOf(SPEC.doltBin);
    const iSql = argsBlock.indexOf("sql-server");
    const iFlag = argsBlock.indexOf("--config");
    const iCfg = argsBlock.indexOf(SPEC.configPath);
    expect(iBin).toBeLessThan(iSql);
    expect(iSql).toBeLessThan(iFlag);
    expect(iFlag).toBeLessThan(iCfg);
  });

  it("should set WorkingDirectory to the supervisor workingDir", () => {
    const plist = renderLaunchdPlist(SPEC);
    expect(plist).toContain("<key>WorkingDirectory</key>");
    expect(plist).toContain(`<string>${SPEC.workingDir}</string>`);
  });

  it("should route StandardOutPath and StandardErrorPath to the logPath", () => {
    const plist = renderLaunchdPlist(SPEC);
    expect(plist).toContain("<key>StandardOutPath</key>");
    expect(plist).toContain("<key>StandardErrorPath</key>");
    const occurrences = plist.split(SPEC.logPath).length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it("should set RunAtLoad true so the server starts at login/load", () => {
    const plist = renderLaunchdPlist(SPEC);
    const idx = plist.indexOf("<key>RunAtLoad</key>");
    expect(idx).toBeGreaterThan(-1);
    expect(plist.slice(idx, idx + 60)).toContain("<true/>");
  });

  it("should configure KeepAlive restarting on crash but not on clean exit", () => {
    const plist = renderLaunchdPlist(SPEC);
    expect(plist).toContain("<key>KeepAlive</key>");
    const block = plist.slice(
      plist.indexOf("<key>KeepAlive</key>"),
      plist.indexOf("</dict>", plist.indexOf("<key>KeepAlive</key>")),
    );
    const crashedIdx = block.indexOf("<key>Crashed</key>");
    expect(crashedIdx).toBeGreaterThan(-1);
    expect(block.slice(crashedIdx, crashedIdx + 40)).toContain("<true/>");
    const exitIdx = block.indexOf("<key>SuccessfulExit</key>");
    expect(exitIdx).toBeGreaterThan(-1);
    expect(block.slice(exitIdx, exitIdx + 50)).toContain("<false/>");
  });

  it("should be deterministic for the same spec", () => {
    expect(renderLaunchdPlist(SPEC)).toBe(renderLaunchdPlist(SPEC));
  });

  it("should XML-escape special characters in string values", () => {
    const plist = renderLaunchdPlist({
      ...SPEC,
      workingDir: "/tmp/weird & <dir>",
    });
    expect(plist).toContain("/tmp/weird &amp; &lt;dir&gt;");
    expect(plist).not.toContain("weird & <dir>");
  });
});

describe("renderSystemdUnit", () => {
  it("should declare a [Unit], [Service], and [Install] section", () => {
    const unit = renderSystemdUnit(SPEC);
    expect(unit).toContain("[Unit]");
    expect(unit).toContain("[Service]");
    expect(unit).toContain("[Install]");
  });

  it("should run the same `dolt sql-server --config <configPath>` ExecStart", () => {
    const unit = renderSystemdUnit(SPEC);
    expect(unit).toContain(
      `ExecStart=${SPEC.doltBin} sql-server --config ${SPEC.configPath}`,
    );
  });

  it("should set WorkingDirectory to the supervisor workingDir", () => {
    const unit = renderSystemdUnit(SPEC);
    expect(unit).toContain(`WorkingDirectory=${SPEC.workingDir}`);
  });

  it("should restart on failure (KeepAlive Crashed equivalent) but not on clean exit", () => {
    const unit = renderSystemdUnit(SPEC);
    // Restart=on-failure restarts on crash/non-zero exit, not on success.
    expect(unit).toContain("Restart=on-failure");
    expect(unit).not.toContain("Restart=always");
  });

  it("should route stdout and stderr to the logPath via append", () => {
    const unit = renderSystemdUnit(SPEC);
    expect(unit).toContain(`StandardOutput=append:${SPEC.logPath}`);
    expect(unit).toContain(`StandardError=append:${SPEC.logPath}`);
  });

  it("should target default.target so RunAtLoad-equivalent autostart works for --user", () => {
    const unit = renderSystemdUnit(SPEC);
    expect(unit).toContain("WantedBy=default.target");
  });

  it("should carry a Description referencing the label", () => {
    const unit = renderSystemdUnit(SPEC);
    expect(unit).toContain("Description=");
    expect(unit).toContain(SPEC.label);
  });

  it("should be deterministic for the same spec", () => {
    expect(renderSystemdUnit(SPEC)).toBe(renderSystemdUnit(SPEC));
  });
});
