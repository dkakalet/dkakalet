import React from "react";
import ReactDOM from "react-dom/client";
import "./storagePolyfill.js";
import WorkoutTracker from "./WorkoutTracker.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <WorkoutTracker />
  </React.StrictMode>
);
