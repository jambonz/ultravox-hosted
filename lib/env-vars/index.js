const router = require('express').Router();

router.use('/', require('./options-handler'));
module.exports = router;
