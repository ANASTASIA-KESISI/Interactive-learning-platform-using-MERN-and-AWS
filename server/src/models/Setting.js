const mongoose = require('mongoose');

// Platform-wide key/value settings an administrator can change at runtime
// without a redeploy. One document per key. Keys are a closed list so a typo
// in a caller cannot silently create a setting nothing reads.
const SETTING_KEYS = Object.freeze(['instructorInviteCode']);

const settingSchema = new mongoose.Schema(
  {
    key: { type: String, enum: SETTING_KEYS, required: true, unique: true },
    value: { type: String, default: '' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

const Setting = mongoose.model('Setting', settingSchema);
module.exports = { Setting, SETTING_KEYS };
