const express = require("express");
const cors = require("cors");
const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Summer Wonderland is running");
});

app.listen(port, () => {
  console.log(`Summer Wonderland running at:${port}`);
});
