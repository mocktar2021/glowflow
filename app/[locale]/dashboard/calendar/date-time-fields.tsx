"use client";

import { useState } from "react";

export function CalendarDateTimeFields({
  initialDate,
  initialTime,
  dateLabel,
  timeLabel,
}: {
  initialDate: string;
  initialTime: string;
  dateLabel: string;
  timeLabel: string;
}) {
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState(initialTime);

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm font-medium">
        {dateLabel}
        <input
          required
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          className="mt-2 h-11 w-full rounded-xl border border-[#dfd2c1] bg-[#fffdf9] px-3 outline-none focus:border-[#b77a42] focus:ring-2 focus:ring-[#b77a42]/20 dark:border-white/15 dark:bg-white/5"
        />
      </label>
      <label className="text-sm font-medium">
        {timeLabel}
        <input
          required
          type="time"
          value={time}
          step={300}
          onChange={(event) => setTime(event.target.value)}
          className="mt-2 h-11 w-full rounded-xl border border-[#dfd2c1] bg-[#fffdf9] px-3 outline-none focus:border-[#b77a42] focus:ring-2 focus:ring-[#b77a42]/20 dark:border-white/15 dark:bg-white/5"
        />
      </label>
      <input type="hidden" name="local_start" value={date && time ? `${date}T${time}` : ""} />
    </div>
  );
}
