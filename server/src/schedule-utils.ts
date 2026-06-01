import { TaskRow } from './database.js';

export function parseLocalDateTime(value: string): Date | null {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (!match) {
    return null;
  }

  const [, year, month, day, hour = '0', minute = '0', second = '0'] = match;
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );

  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatLocalDateTime(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  const second = String(date.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

export function getCronExpression(task: Pick<TaskRow, 'schedule_type' | 'schedule_expression'>): string | null {
  switch (task.schedule_type) {
    case 'cron':
      return task.schedule_expression.trim();
    case 'daily':
      return parseDaily(task.schedule_expression);
    case 'weekly':
      return parseWeekly(task.schedule_expression);
    case 'monthly':
      return parseMonthly(task.schedule_expression);
    case 'hourly':
      return parseHourly(task.schedule_expression);
    default:
      return null;
  }
}

export function calculateNextRun(task: Pick<TaskRow, 'schedule_type' | 'schedule_expression'>, fromDate = new Date()): string | null {
  switch (task.schedule_type) {
    case 'once':
      return calculateOnce(task.schedule_expression, fromDate);
    case 'daily':
      return calculateDaily(task.schedule_expression, fromDate);
    case 'weekly':
      return calculateWeekly(task.schedule_expression, fromDate);
    case 'monthly':
      return calculateMonthly(task.schedule_expression, fromDate);
    case 'hourly':
      return calculateHourly(task.schedule_expression, fromDate);
    case 'cron':
    default:
      return null;
  }
}

function parseDaily(expression: string): string {
  const [hour, minute] = parseHourMinute(expression) ?? [9, 0];
  return `${minute} ${hour} * * *`;
}

function parseWeekly(expression: string): string {
  const [weekdayRaw, timeRaw] = expression.trim().split(/\s+/, 2);
  const weekday = clampNumber(Number.parseInt(weekdayRaw, 10), 0, 6, 1);
  const [hour, minute] = parseHourMinute(timeRaw) ?? [9, 0];
  return `${minute} ${hour} * * ${weekday}`;
}

function parseMonthly(expression: string): string {
  const [dayRaw, timeRaw] = expression.trim().split(/\s+/, 2);
  const day = clampNumber(Number.parseInt(dayRaw, 10), 1, 31, 1);
  const [hour, minute] = parseHourMinute(timeRaw) ?? [9, 0];
  return `${minute} ${hour} ${day} * *`;
}

function parseHourly(expression: string): string {
  const minute = clampNumber(Number.parseInt(expression, 10), 0, 59, 0);
  return `${minute} * * * *`;
}

function calculateOnce(expression: string, fromDate: Date): string | null {
  const date = parseLocalDateTime(expression);
  if (!date || date <= fromDate) {
    return null;
  }
  return date.toISOString();
}

function calculateDaily(expression: string, fromDate: Date): string {
  const [hour, minute] = parseHourMinute(expression) ?? [9, 0];
  const next = new Date(fromDate);
  next.setSeconds(0, 0);
  next.setHours(hour, minute, 0, 0);

  if (next <= fromDate) {
    next.setDate(next.getDate() + 1);
  }

  return next.toISOString();
}

function calculateWeekly(expression: string, fromDate: Date): string {
  const [weekdayRaw, timeRaw] = expression.trim().split(/\s+/, 2);
  const targetDay = clampNumber(Number.parseInt(weekdayRaw, 10), 0, 6, 1);
  const [hour, minute] = parseHourMinute(timeRaw) ?? [9, 0];
  const next = new Date(fromDate);
  next.setSeconds(0, 0);
  next.setHours(hour, minute, 0, 0);

  let delta = targetDay - next.getDay();
  if (delta < 0 || (delta === 0 && next <= fromDate)) {
    delta += 7;
  }

  next.setDate(next.getDate() + delta);
  return next.toISOString();
}

function calculateMonthly(expression: string, fromDate: Date): string {
  const [dayRaw, timeRaw] = expression.trim().split(/\s+/, 2);
  const targetDay = clampNumber(Number.parseInt(dayRaw, 10), 1, 31, 1);
  const [hour, minute] = parseHourMinute(timeRaw) ?? [9, 0];

  const next = buildMonthlyDate(fromDate.getFullYear(), fromDate.getMonth(), targetDay, hour, minute);
  if (next <= fromDate) {
    const rollover = new Date(fromDate.getFullYear(), fromDate.getMonth() + 1, 1);
    return buildMonthlyDate(rollover.getFullYear(), rollover.getMonth(), targetDay, hour, minute).toISOString();
  }

  return next.toISOString();
}

function calculateHourly(expression: string, fromDate: Date): string {
  const targetMinute = clampNumber(Number.parseInt(expression, 10), 0, 59, 0);
  const next = new Date(fromDate);
  next.setSeconds(0, 0);
  next.setMinutes(targetMinute, 0, 0);

  if (next <= fromDate) {
    next.setHours(next.getHours() + 1);
    next.setMinutes(targetMinute, 0, 0);
  }

  return next.toISOString();
}

function buildMonthlyDate(year: number, month: number, day: number, hour: number, minute: number): Date {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, lastDay), hour, minute, 0, 0);
}

function parseHourMinute(value: string | undefined): [number, number] | null {
  if (!value) {
    return null;
  }

  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return [hour, minute];
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (Number.isNaN(value)) {
    return fallback;
  }
  return Math.min(Math.max(value, min), max);
}
