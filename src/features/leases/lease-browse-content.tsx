import { ChevronDown, ChevronRight } from "lucide-react";
import styles from "./lease-browse-content.module.css";

interface LeaseLocation {
  id: string;
  name: string;
  countLabel: string;
  followUpLabel: string;
  hasFollowUp: boolean;
}

export function LeaseLocationIndex({
  label,
  locations,
  onSelect,
}: {
  label: string;
  locations: readonly LeaseLocation[];
  onSelect: (id: string) => void;
}) {
  return (
    <ul className={styles.locations} aria-label={label}>
      {locations.map(({ id, name, countLabel, followUpLabel, hasFollowUp }) => (
        <li key={id}>
          <button type="button" className={styles.location} onClick={() => onSelect(id)}>
            <span className={styles.locationIdentity}>
              <strong>{name}</strong>
              <span>{countLabel}</span>
            </span>
            <span className={styles.locationFollowUp} data-attention={hasFollowUp || undefined}>
              {followUpLabel}
            </span>
            <ChevronRight size={15} className={styles.locationChevron} aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
}

export function LeaseBrowseStatusFilter({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string; count: number | null }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className={styles.statusControl}>
      <select
        aria-label={label}
        className={styles.statusSelect}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label} · {option.count ?? "—"}
          </option>
        ))}
      </select>
      <ChevronDown className={styles.statusChevron} size={14} aria-hidden="true" />
    </div>
  );
}
