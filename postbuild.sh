#!/bin/bash

FILE=src/backend/assets/generated.rs

# Start the file with required headers
cat > $FILE << 'EOF'
use super::add_asset;

pub fn load() {
EOF

# Process each .js.gz file
for f in dist/frontend/*.js; do
    gzip -9nf $f

    # Generate the asset entry
    echo "    add_asset(" >> $FILE
    echo "        &[\"${f#dist/frontend}\"]," >> $FILE
    echo "        vec![" >> $FILE
    echo "            (\"Content-Type\".to_string(), \"text/javascript\".to_string())," >> $FILE
    echo "            (\"Content-Encoding\".to_string(), \"gzip\".to_string())," >> $FILE
    echo "        ]," >> $FILE
    echo "        include_bytes!(\"../../../$f.gz\").to_vec()," >> $FILE
    echo "    );" >> $FILE
done

# Close the function
echo "}" >> $FILE
