const express = require("express");
const app = express();
app.use(express.json());
app.post("/test", (req, res) => {
    console.log("body:", req.body);
    res.json({ body: req.body });
});
app.listen(9999, () => console.log("Test server on 9999"));
