/**
 * SPDX-FileCopyrightText: 2026 hotochan123
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/*
 * Public entry of the scene (SPEC-M0 §6.3, v2 SPEC-M1 §6.3). BoardSession
 * [C] imports the SceneManager from here; the JSDoc types (Camera, Point,
 * Tool, ToolOptions, Box, Endpoint, RemoteSample, SceneVoteState, Intent,
 * SceneCallbacks) are declared in SceneManager.js and re-exported for
 * editors via the import below. TOOLS = the tool ids of src/model/tools.js.
 *
 * @typedef {import('./SceneManager.js').Camera} Camera
 * @typedef {import('./SceneManager.js').Point} Point
 * @typedef {import('./SceneManager.js').Tool} Tool
 * @typedef {import('./SceneManager.js').ToolOptions} ToolOptions
 * @typedef {import('./SceneManager.js').Box} Box
 * @typedef {import('./SceneManager.js').Endpoint} Endpoint
 * @typedef {import('./SceneManager.js').RemoteSample} RemoteSample
 * @typedef {import('./SceneManager.js').SceneVoteState} SceneVoteState
 * @typedef {import('./SceneManager.js').Intent} Intent
 * @typedef {import('./SceneManager.js').SceneCallbacks} SceneCallbacks
 * @typedef {import('../model/SceneModel.js').ChangeSummary} ChangeSummary
 */
export { SceneManager, TOOLS } from './SceneManager.js'
