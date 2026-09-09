import { useId } from "react";
import { useTranslation } from "react-i18next";
import { CalendarBlank } from "@phosphor-icons/react/CalendarBlank";
import { CaretDown } from "@phosphor-icons/react/CaretDown";
import {
  STUDIO_DATE_RANGE_PRESETS,
  dateRangeInverted,
  resolveDateRange,
  type StudioDateRange,
} from "../date-range.js";

/**
 * The one observation window, directly under the Project switcher.
 *
 * It sits in the sidebar because it scopes every "observe" View at once: the
 * Project says *where* to look and this says *when*. Views below it no longer
 * carry calendars of their own.
 */
export function DateRangeFilter(props: {
  range: StudioDateRange;
  onChange: (range: StudioDateRange) => void;
}): React.JSX.Element {
  const { t } = useTranslation("common");
  const fromId = useId();
  const toId = useId();
  const errorId = useId();
  const resolved = resolveDateRange(props.range);
  const inverted = props.range.preset === "custom" && dateRangeInverted(props.range);

  return <div className="studio-date-range">
    <label className="studio-date-range-preset">
      <CalendarBlank aria-hidden="true" size={15} />
      <select
        aria-label={t("dateRange.aria")}
        value={props.range.preset}
        onChange={(event) => {
          const preset = event.target.value as StudioDateRange["preset"];
          // Switching to custom seeds the inputs from the window already on
          // screen, so the reader adjusts a real span instead of two blanks.
          props.onChange(preset === "custom"
            ? { preset, ...(resolved.from === undefined ? {} : { from: resolved.from }), ...(resolved.to === undefined ? {} : { to: resolved.to }) }
            : { preset });
        }}
      >
        {STUDIO_DATE_RANGE_PRESETS.map((preset) => <option key={preset} value={preset}>
          {t(`dateRange.preset.${preset}`)}
        </option>)}
      </select>
      <CaretDown aria-hidden="true" size={13} />
    </label>
    {props.range.preset === "custom" && <div className="studio-date-range-custom" role="group" aria-label={t("dateRange.preset.custom")}>
      <label htmlFor={fromId}>{t("dateRange.from")}</label>
      <input
        id={fromId}
        type="date"
        value={props.range.from ?? ""}
        max={props.range.to}
        aria-invalid={inverted || undefined}
        aria-describedby={inverted ? errorId : undefined}
        onChange={(event) => props.onChange({ ...props.range, from: event.target.value === "" ? undefined : event.target.value })}
      />
      <label htmlFor={toId}>{t("dateRange.to")}</label>
      <input
        id={toId}
        type="date"
        value={props.range.to ?? ""}
        min={props.range.from}
        aria-invalid={inverted || undefined}
        aria-describedby={inverted ? errorId : undefined}
        onChange={(event) => props.onChange({ ...props.range, to: event.target.value === "" ? undefined : event.target.value })}
      />
    </div>}
    {inverted
      ? <p id={errorId} className="studio-date-range-summary status-warning" role="alert">{t("dateRange.inverted")}</p>
      : props.range.preset !== "custom" && props.range.preset !== "all" && <p className="studio-date-range-summary">{summary(resolved, t)}</p>}
  </div>;
}

function summary(
  resolved: StudioDateRange,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (resolved.preset === "all") return t("dateRange.summaryAll");
  if (resolved.from !== undefined && resolved.to !== undefined) {
    return resolved.from === resolved.to
      ? t("dateRange.summaryDay", { day: resolved.from })
      : t("dateRange.summarySpan", { from: resolved.from, to: resolved.to });
  }
  if (resolved.from !== undefined) return t("dateRange.summaryFrom", { from: resolved.from });
  if (resolved.to !== undefined) return t("dateRange.summaryTo", { to: resolved.to });
  return t("dateRange.summaryOpen");
}
