#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

function normalizeSectionName(input) {
  const raw = input?.trim();
  if (!raw) {
    return null;
  }

  const value = basename(raw);
  if (/^v\d+\.\d+\.\d+$/.test(value)) {
    return value;
  }

  return value;
}

function parseSections(markdown) {
  const lines = markdown.split(/\r?\n/);
  const sections = [];
  let current = null;

  for (const line of lines) {
    const match = line.match(/^## \[(.+?)\](?: - .+)?$/);

    if (match) {
      if (current) {
        sections.push(current);
      }

      current = {
        name: match[1],
        lines: []
      };
      continue;
    }

    if (current) {
      current.lines.push(line);
    }
  }

  if (current) {
    sections.push(current);
  }

  return sections.map((section) => ({
    name: section.name,
    body: section.lines.join('\n').trim()
  }));
}

function hasMeaningfulContent(body) {
  const contentLines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^\[[^\]]+\]:\s+\S+/.test(line))
    .filter((line) => !line.startsWith('### '));

  if (contentLines.length === 0) {
    return false;
  }

  return !contentLines.every((line) => /^- None(?: yet)?\.$/.test(line));
}

const sectionName = normalizeSectionName(process.argv[2] ?? process.env.RELEASE_TAG);

if (!sectionName) {
  console.error('Usage: node scripts/extract-changelog-section.mjs <section-name>');
  process.exit(1);
}

const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
const sections = parseSections(changelog);
const match = sections.find((section) => section.name === sectionName);

if (!match) {
  console.error(
    `Missing changelog section for ${sectionName}. Add "## [${sectionName}] - YYYY-MM-DD" to CHANGELOG.md before tagging.`
  );
  process.exit(1);
}

const releaseNotes = match.body
  .split(/\r?\n/)
  .filter((line) => !/^\[[^\]]+\]:\s+\S+/.test(line.trim()))
  .join('\n')
  .trim();

if (!hasMeaningfulContent(releaseNotes)) {
  console.error(`Changelog section ${sectionName} does not contain any release notes.`);
  process.exit(1);
}

process.stdout.write(`${releaseNotes}\n`);
