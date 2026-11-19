import styles from "./home.module.css";

export function render(): string {
  return `<div class="${styles.hero} ${styles["is-open"]}">home</div>`;
}
