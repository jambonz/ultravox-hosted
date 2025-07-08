const router = require('express').Router();

router.use('/', require('./options-handler'));
router.use('/ultravox', require('./options-handler'));
module.exports = router;
