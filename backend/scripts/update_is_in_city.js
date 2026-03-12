"use strict";
const { getDB } = require("../lib/db");

async function run() {
    console.log("🚀 Starting database update: setting isInCity = 1 for all profiles...");

    try {
        const db = await getDB();

        // Count how many profiles we have before update
        const countBefore = await db.get("SELECT COUNT(*) as count FROM profiles");
        console.log(`📊 Found ${countBefore.count} total profiles in database.`);

        // Execute update
        const result = await db.run("UPDATE profiles SET isInCity = 1");

        console.log(`✅ Update complete!`);
        console.log(`📝 Rows affected: ${result.changes}`);

        // Verify 
        const countAfter = await db.get("SELECT COUNT(*) as count FROM profiles WHERE isInCity = 1");
        console.log(`🎯 Profiles with isInCity = 1 now: ${countAfter.count}`);

        if (countAfter.count === countBefore.count) {
            console.log("🌟 Success! All profiles updated correctly.");
        } else {
            console.warn("⚠️ Warning: counts do not match. Please investigate.");
        }

    } catch (error) {
        console.error("❌ Error during database update:", error);
        process.exit(1);
    } finally {
        console.log("👋 Script finished.");
        process.exit(0);
    }
}

run();
