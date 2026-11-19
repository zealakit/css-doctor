import styles from "./card.module.css";
import other from "./other.module.css";

document.body.className = styles.hero + " " + styles["is-open"];
console.log(other[window.key]);
